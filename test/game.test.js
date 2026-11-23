import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { assignRoles, createGameServer, lanUrls } from '../server.js'
import { createMatch, act, RuleError, wildlifeWeights } from '../lib/game.js'
import { matchView } from '../lib/view.js'
import { MAP, CAMP, GEAR } from '../lib/config.js'

const seats = [
  { id: 'a', name: 'Stevie', role: 'hunter' },
  { id: 'b', name: 'Lee', role: 'hunter' },
  { id: 'c', name: 'Creature', role: 'cryptid' },
]
const game = (species = 'Sasquatch', classes = {}) =>
  createMatch(seats.map(player => ({ ...player, hunterClass: classes[player.id] })), species, () => 0)
const doAction = (state, actor, type, target, extra = {}) => act(state, actor, { type, target, ...extra })
const cryptidPhase = state => { state.phase = 'cryptid'; state.cryptid.ap = 2 }
const device = (type, pos) => ({ id: randomUUID(), type, pos, occupants: [], recordings: [], gear: [], cargo: [], activated: null })
const evidence = (type, pos, round, extra = {}) => ({ id: randomUUID(), type, pos, round, ...extra })
const equip = (hunter, ...types) => hunter.gear.push(...types.map(type => ({ id: randomUUID(), type, qty: GEAR[type].size })))

test('hunter actions interleave and Search, netgun, move, capture ends the match immediately', () => {
  const state = game()
  for (const hunter of state.hunters) equip(hunter, 'netgun')
  state.hunters[0].pos = state.cryptid.pos = 'D6'
  doAction(state, 'a', 'search')
  doAction(state, 'b', 'move', 'D6')
  doAction(state, 'a', 'shoot')
  const cash = state.cash
  assert.throws(() => doAction(state, 'b', 'shoot'), RuleError)
  assert.equal(state.hunters[1].ap, 1)
  assert.equal(state.hunters[1].gear[0].qty, 2)
  doAction(state, 'b', 'capture')
  assert.equal(state.winner, 'hunters')
  assert.equal(state.cash, cash)
  assert.throws(() => doAction(state, 'a', 'capture'), RuleError)
})

test('all hunters must explicitly end before wildlife and the Cryptid act; upkeep charges once', () => {
  const state = game()
  assert.equal(matchView(state, 'c').player.hunger, 0)
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'search')
  assert.equal(state.phase, 'hunters')
  doAction(state, 'a', 'end')
  assert.equal(state.phase, 'hunters')
  doAction(state, 'b', 'end')
  assert.equal(state.phase, 'cryptid')
  assert.equal(matchView(state, 'c').player.hunger, 1)
  const cash = state.cash
  doAction(state, 'c', 'end')
  assert.equal(state.phase, 'hunters')
  assert.equal(state.round, 2)
  assert.equal(state.cash, cash - state.upkeep)
  assert.deepEqual(state.hunters.map(({ ap, ended }) => [ap, ended]), [[2, false], [2, false]])
})

test('Cryptid entry reveals, escape preserves the sighting, and departure marks the destination', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  cryptidPhase(state)
  doAction(state, 'c', 'move', CAMP)
  assert.equal(matchView(state, 'a').cryptid.pos, CAMP)
  state.cryptid.restraint = { device: null }
  doAction(state, 'c', 'escape')
  assert.equal(matchView(state, 'a').cryptid.live, true)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  assert.equal(matchView(state, 'a').cryptid.pos, 'D6')
  assert.equal(matchView(state, 'a').cryptid.live, false)
})

test('a hunter can follow a Cryptid that ran through their space and net it without searching', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  equip(state.hunters[0], 'netgun')
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', CAMP)
  doAction(state, 'c', 'move', 'C7')
  const before = matchView(state, 'a')
  assert.equal(before.cryptid.pos, 'C7')
  assert.equal(before.cryptid.live, false)
  assert.equal(before.clues.find(clue => clue.type === 'sighting').pos, CAMP)
  doAction(state, 'a', 'move', 'C7')
  assert.equal(matchView(state, 'b').cryptid.live, true)
  assert.equal(state.hunters[0].ap, 1)
  assert.ok(matchView(state, 'a').actions.some(action => action.type === 'shoot'))
  doAction(state, 'a', 'shoot')
  assert.equal(matchView(state, 'b').cryptid.restrained, true)
  assert.equal(state.hunters[0].ap, 0)
})

test('unseen movement leaves the last-known marker behind and still requires a search', () => {
  const state = game()
  state.cryptid.pos = CAMP
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', 'D6')
  doAction(state, 'c', 'move', 'D5')
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'move', 'D5')
  assert.equal(matchView(state, 'a').cryptid.pos, 'D6')
  assert.equal(matchView(state, 'a').cryptid.live, false)
  assert.equal(state.cryptid.seen, null)
})

test('snares interrupt in-space interactions for free while permitting departure after escape', () => {
  const state = game()
  state.cryptid.pos = CAMP
  const traps = [device('snare', 'D6'), device('snare', 'D6')]
  const tent = device('tent', 'D6')
  state.devices.push(...traps, tent)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  assert.equal(state.cryptid.restraint.device, traps[0].id)
  doAction(state, 'c', 'escape')
  assert.equal(state.cryptid.restraint, null)
  cryptidPhase(state)
  doAction(state, 'c', 'destroy', tent.id)
  assert.ok(state.devices.includes(tent))
  assert.equal(state.cryptid.ap, 2)
  assert.equal(state.cryptid.restraint.device, traps[1].id)
  doAction(state, 'c', 'escape')
  state.devices.push(device('snare', 'D6'))
  doAction(state, 'c', 'move', CAMP)
  assert.equal(state.cryptid.restraint, null)
})

test('feeding at maximum hunger suppresses warnings, and starving creates different relative bearings', () => {
  const state = game()
  state.cryptid.pos = 'D4'
  state.hunters[0].pos = 'D6'
  state.hunters[1].pos = 'B4'
  state.cryptid.hunger = 5
  cryptidPhase(state)
  const turkey = state.animals.find(animal => animal.pos === 'D4')
  turkey.tagged = true
  const marker = matchView(state, 'a').animals.find(item => item.id === turkey.id)
  doAction(state, 'c', 'feed', turkey.id)
  assert.equal(state.cryptid.hunger, 2)
  doAction(state, 'c', 'move', 'D5')
  assert.equal(state.cryptid.pos, 'D5')
  assert.deepEqual(state.warnings, {})
  assert.deepEqual(matchView(state, 'a').animals.find(item => item.id === turkey.id), marker)
  assert.ok(!matchView(state, 'a').clues.some(clue => clue.type === 'feed'))
  state.cryptid.hunger = 5
  cryptidPhase(state)
  doAction(state, 'c', 'end')
  assert.equal(state.warnings.a.dir, 'N')
  assert.equal(state.warnings.b.dir, 'E')
})

test('a swallowed tag follows silently through the next Cryptid turn and grants one scat photo on arrival', () => {
  const state = game()
  const rabbit = state.animals[0]
  state.animals = [rabbit]
  state.cryptid.pos = rabbit.pos = 'D5'
  rabbit.tagged = true
  state.random = () => .4
  cryptidPhase(state)
  const hunterLog = matchView(state, 'a').logs.length
  const signal = matchView(state, 'a').animals[0]
  doAction(state, 'c', 'feed', rabbit.id)
  assert.equal(matchView(state, 'a').logs.length, hunterLog)
  assert.deepEqual(matchView(state, 'a').animals[0], signal)
  assert.equal(matchView(state, 'c').logs[0].message, 'You fed on a rabbit.')
  assert.ok(!JSON.stringify(matchView(state, 'c')).includes('tagSignal'))

  doAction(state, 'c', 'move', 'E5')
  assert.equal(state.round, 2)
  assert.deepEqual(matchView(state, 'a').animals[0], { ...signal, pos: 'E5' })
  assert.equal(matchView(state, 'a').cryptid, null)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', 'E6')
  assert.deepEqual(matchView(state, 'a').animals[0], { ...signal, pos: 'E6' })
  doAction(state, 'c', 'move', 'E7')
  assert.equal(state.round, 3)
  assert.deepEqual(matchView(state, 'a').animals[0], { ...signal, pos: 'E7' })

  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', 'E6')
  doAction(state, 'c', 'end')
  assert.deepEqual(matchView(state, 'a').animals[0], { ...signal, pos: 'E7' })
  const cryptidLog = matchView(state, 'c').logs
  doAction(state, 'a', 'move', 'E7')
  const recovered = matchView(state, 'a')
  assert.equal(recovered.player.ap, 1)
  assert.deepEqual(recovered.player.digital.map(({ name, photo, value }) => [name, photo, value]),
    [['Scat evidence', true, 110]])
  assert.deepEqual(recovered.animals, [])
  assert.equal(recovered.cryptid, null)
  doAction(state, 'b', 'move', 'E7')
  assert.deepEqual(matchView(state, 'b').player.digital, [])
  assert.deepEqual(matchView(state, 'c').logs, cryptidLog)
  assert.ok(!cryptidLog.some(entry => /scat|tag/.test(entry.message)))
})

test('Search lists surviving visits with precise age and identical false trail presentation', () => {
  const state = game()
  equip(state.hunters[0], 'kit')
  state.round = 8
  const old = evidence('tracks', CAMP, 1, { dir: 'W' })
  const fake = evidence('tracks', CAMP, 3, { dir: 'N', falseTrail: true })
  const real = evidence('tracks', CAMP, 7, { dir: 'E' })
  state.clues.push(old, fake, real)
  doAction(state, 'b', 'search')
  const basic = matchView(state, 'a').clues
  assert.deepEqual(basic.map(clue => clue.date), ['Fresh', 'Cold'])
  doAction(state, 'a', 'search')
  const precise = matchView(state, 'b').clues
  assert.deepEqual(precise.map(clue => [clue.name, clue.date]), [
    ['Footprints heading east', '1 round ago'], ['Footprints heading north', '5 rounds ago'],
  ])
  assert.deepEqual(Object.keys(precise[0]), Object.keys(precise[1]))
  assert.equal(precise.some(clue => Object.hasOwn(clue, 'falseTrail')), false)
})

test('Search automatically takes one photo per hunter and sale estimates track team submissions', () => {
  const state = game()
  state.cryptid.pos = CAMP
  state.clues.push(evidence('tracks', CAMP, 1, { dir: 'N' }), evidence('feed', CAMP, 1))
  doAction(state, 'a', 'search')
  const original = matchView(state, 'a').player.digital
  assert.deepEqual(original.map(({ type, value }) => [type, value]),
    [['tracks', 60], ['feed', 110], ['sighting', 180]])
  assert.ok(original.every(item => item.photo))
  assert.equal(state.hunters[0].cargo.length, 0)
  doAction(state, 'a', 'search')
  assert.deepEqual(matchView(state, 'a').player.digital, original)
  doAction(state, 'b', 'search')
  doAction(state, 'b', 'submit')
  const revised = matchView(state, 'a').player.digital.map(item => item.value)
  assert.deepEqual(revised, [38, 70, 115])
  const before = state.cash
  doAction(state, 'a', 'submit')
  assert.equal(state.cash - before, revised.reduce((sum, value) => sum + value, 0))
})

test('Search with no clues takes a $25 context photo and repeated sales depreciate', () => {
  const state = game()
  state.devices.push(device('detector', CAMP))
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'submit')
  doAction(state, 'a', 'search')
  const [group] = matchView(state, 'a').player.digital
  assert.equal(group.name, '"Me and the boys"')
  assert.equal(group.value, 20)
  assert.equal(state.cash, 2025)
  for (const [type, title] of [['gearPhoto', '"The hunt is on"'], ['naturePhoto', '"Nature is beautiful"']]) {
    const solo = game()
    solo.hunters[0].pos = 'D6'
    if (type === 'gearPhoto') solo.devices.push(device('detector', 'D6'))
    doAction(solo, 'a', 'search')
    const [photo] = matchView(solo, 'a').player.digital
    assert.deepEqual([photo.type, photo.name, photo.value], [type, title, 25])
  }
})

test('sample and photo estimates reflect their order in a combined submission', () => {
  const state = game()
  const remains = evidence('feed', CAMP, state.round)
  state.clues.push(remains)
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'collect', remains.id)
  const { player } = matchView(state, 'a')
  assert.equal(player.cargo[0].value, 110)
  assert.equal(player.digital[0].value, 70)
  doAction(state, 'a', 'submit')
  assert.equal(state.cash, 2000 + player.cargo[0].value + player.digital[0].value)
})

test('photos and videos use the evidence curve with $5 and $25 payout floors', () => {
  const state = game()
  const hunter = state.hunters[0]
  for (let index = 0; index < 9; index++) {
    state.clues.push(evidence('tracks', CAMP, 1, { dir: 'N' }))
  }
  doAction(state, 'a', 'search')
  for (const type of ['animalVideo', 'cryptidVideo', 'behaviorVideo']) {
    hunter.digital.push({ id: randomUUID(), type, source: randomUUID() })
  }
  state.sales['evidence:cryptidVideo'] = 6
  state.sales['evidence:behaviorVideo'] = 7
  const values = matchView(state, 'a').player.digital.map(item => item.value)
  assert.deepEqual(values, [60, 48, 39, 30, 21, 12, 6, 5, 5, 25, 25, 25])
  const before = state.cash
  doAction(state, 'a', 'submit')
  assert.equal(state.cash - before, 301)
})

test('camp meat payouts still decline separately for each species', () => {
  const state = game()
  const hunter = state.hunters[0]
  const payouts = { rabbit: [], turkey: [], deer: [] }
  for (const animal of state.animals) {
    animal.status = 'carried'
    animal.owner = hunter.id
    hunter.cargo.push(animal)
    const before = state.cash
    doAction(state, 'a', 'sellMeat')
    payouts[animal.species].push(state.cash - before)
  }
  assert.deepEqual(payouts, { rabbit: [60, 36, 18, 6, 0], turkey: [90, 54, 27], deer: [125, 75] })
})

test('charge growth count depends on the Cryptid species', () => {
  for (const [species, count] of [['Bigfoot', 6], ['Sasquatch', 4], ['Mothman', 3]]) {
    const state = game(species)
    assert.equal(new Set(matchView(state, 'c').chargeGrowths.map(growth => growth.pos)).size, count)
    assert.equal(state.chargeGrowths.length, count)
  }
})

test('charge growth is private, usable locally once, and leaves hunger unchanged', () => {
  const state = game('Mothman')
  const growth = state.chargeGrowths[0]
  state.cryptid.pos = growth.pos
  cryptidPhase(state)
  const hunterBefore = matchView(state, 'a')
  const privateView = matchView(state, 'c')
  assert.ok(privateView.chargeGrowths.some(item => item.pos === growth.pos))
  assert.ok(privateView.actions.some(action => action.type === 'feedGrowth'))
  assert.equal(hunterBefore.chargeGrowths, undefined)
  assert.equal(hunterBefore.player.charges, undefined)
  const hunger = state.cryptid.hunger
  doAction(state, 'c', 'feedGrowth', growth.id)
  assert.equal(state.cryptid.charges, 1)
  assert.equal(state.cryptid.hunger, hunger)
  assert.ok(!matchView(state, 'c').chargeGrowths.some(item => item.pos === growth.pos))
  assert.deepEqual(matchView(state, 'a'), hunterBefore)
  assert.throws(() => doAction(state, 'c', 'feedGrowth', growth.id), RuleError)
  assert.equal(state.cryptid.ap, 1)
})

test('Mothman flies past blocked routes and intermediate hazards but resolves the landing', () => {
  const state = game('Mothman')
  state.cryptid.pos = 'B2'
  state.cryptid.charges = 2
  state.hunters[0].pos = 'C2'
  state.hunters[1].pos = 'D2'
  const middle = device('snare', 'C2')
  const landing = device('snare', 'D2')
  const camera = device('camera', 'B2')
  state.devices.push(middle, landing, camera, { ...device('blockade', 'C2'), to: 'D2' })
  cryptidPhase(state)
  assert.equal(MAP.B2.exits.E, undefined)
  assert.throws(() => doAction(state, 'c', 'ability', 'W'), RuleError)
  state.gas.set('D2', state.round)
  assert.throws(() => doAction(state, 'c', 'ability', 'E'), RuleError)
  assert.equal(state.cryptid.charges, 2)
  assert.equal(state.cryptid.ap, 2)
  state.gas.delete('D2')
  state.gas.set('C2', state.round)
  doAction(state, 'c', 'ability', 'E')
  assert.equal(state.cryptid.pos, 'D2')
  assert.equal(state.cryptid.charges, 1)
  assert.equal(state.cryptid.ap, 1)
  assert.equal(state.cryptid.restraint.device, landing.id)
  assert.equal(matchView(state, 'a').cryptid.pos, 'D2')
  assert.ok(state.devices.includes(middle))
  assert.ok(!state.clues.some(clue => clue.type === 'tracks'))
  assert.equal(camera.recordings[0].type, 'behaviorVideo')
})

test('the Ranger owns two persistent trail blockades that can be recovered or destroyed at either end', () => {
  const state = game('Sasquatch', { a: 'ranger' })
  state.cryptid.pos = CAMP
  assert.ok(matchView(state, 'a').blockadeTargets.includes('D6'))
  assert.deepEqual(matchView(state, 'b').blockadeTargets, [])
  assert.throws(() => doAction(state, 'a', 'blockade', 'D4'), RuleError)
  doAction(state, 'a', 'blockade', 'D6')
  assert.equal(matchView(state, 'a').player.ap, 1)
  doAction(state, 'a', 'blockade', 'C7')
  assert.equal(matchView(state, 'a').player.ap, 0)
  assert.equal(matchView(state, 'a').player.blockades, 0)
  assert.deepEqual(matchView(state, 'a').blockadeTargets, [])
  const [north, west] = state.devices
  assert.throws(() => doAction(state, 'b', 'recover', north.id), /Park Ranger/)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  assert.ok(!matchView(state, 'c').moves.includes('D6'))
  assert.throws(() => doAction(state, 'c', 'move', 'D6'), RuleError)
  assert.equal(state.cryptid.ap, 2)
  doAction(state, 'c', 'move', 'E7')
  doAction(state, 'c', 'end')
  assert.ok(state.devices.includes(north) && state.devices.includes(west))
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'recover', north.id)
  assert.equal(matchView(state, 'a').player.blockades, 1)
  assert.ok(!state.devices.includes(north))
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', CAMP)
  doAction(state, 'c', 'destroy', west.id)
  assert.equal(state.devices.length, 0)
  assert.equal(matchView(state, 'a').player.blockades, 1)
  assert.ok(matchView(state, 'a').devices.some(item => item.id === west.id && !item.broken))
})

test('the Trail Biker rides two connected sectors once for one AP and stops when snared halfway', () => {
  const state = game('Sasquatch', { a: 'biker' })
  const view = matchView(state, 'a')
  assert.deepEqual(view.bikeMoves, ['D5'])
  assert.throws(() => doAction(state, 'a', 'bike', 'F7'), RuleError)
  doAction(state, 'a', 'bike', 'D5')
  assert.equal(state.hunters[0].pos, 'D5')
  assert.equal(state.hunters[0].ap, 1)
  assert.throws(() => doAction(state, 'a', 'bike', 'D3'), RuleError)
  doAction(state, 'a', 'move', 'D4')
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'end')
  assert.ok(matchView(state, 'a').bikeMoves.includes('D2'))
  state.cryptidSnares.push({ id: randomUUID(), pos: 'D3', discovered: false })
  doAction(state, 'a', 'bike', 'D2')
  assert.equal(state.hunters[0].pos, 'D3')
  assert.equal(state.hunters[0].ap, 1)
  assert.ok(state.hunters[0].restraint)
  assert.deepEqual(matchView(state, 'a').bikeMoves, [])
})

test('the Prepper starts with a loaded netgun, four slots and $200 extra team cash', () => {
  const state = game('Sasquatch', { a: 'prepper' })
  const hunter = state.hunters[0]
  assert.equal(state.cash, 2200)
  assert.deepEqual(hunter.gear.map(({ type, qty }) => [type, qty]), [['netgun', 2]])
  assert.equal(matchView(state, 'a').player.equipmentCapacity, 4)
  assert.equal(matchView(state, 'b').player.equipmentCapacity, 3)
  for (const type of ['kit', 'detector', 'snare']) {
    doAction(state, 'a', 'buy', type)
    doAction(state, 'a', 'takeGear', state.cache.gear.find(pack => pack.type === type).id)
  }
  assert.equal(hunter.gear.length, 4)
  doAction(state, 'a', 'buy', 'gas')
  assert.throws(() => doAction(state, 'a', 'takeGear', state.cache.gear[0].id), /No free equipment slot/)
})

test('the Trapper starts with three snares and can deploy one per round at zero AP', () => {
  const state = game('Sasquatch', { a: 'trapper' })
  const [trapper, teammate] = state.hunters
  const deploySnare = () => matchView(state, 'a').actions.find(action => action.type === 'deploy' && action.target === 'snare')
  assert.deepEqual(trapper.gear.map(({ type, qty }) => [type, qty]), [['snare', 3]])
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'search')
  assert.equal(deploySnare()?.label, 'Deploy snare · 0 AP')
  doAction(state, 'a', 'deploy', 'snare')
  assert.equal(state.devices[0].pos, 'D6')
  assert.equal(trapper.ap, 0)
  assert.equal(trapper.gear[0].qty, 2)
  assert.equal(deploySnare(), undefined)
  assert.throws(() => doAction(state, 'a', 'deploy', 'snare'), /no actions left/)

  equip(teammate, 'snare')
  doAction(state, 'b', 'deploy', 'snare')
  assert.equal(teammate.ap, 1)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'end')
  assert.equal(deploySnare()?.label, 'Deploy snare · 0 AP')
  doAction(state, 'a', 'deploy', 'snare')
  assert.equal(trapper.ap, 2)
  assert.equal(deploySnare()?.label, 'Deploy snare')
  doAction(state, 'a', 'deploy', 'snare')
  assert.equal(trapper.ap, 1)
  assert.equal(trapper.gear.length, 0)
})

test('the True Believer privately identifies false tracks and earns 25% more on photos and tapes', () => {
  const state = game('Sasquatch', { b: 'believer' })
  const falseTrail = evidence('tracks', CAMP, 1, { dir: 'N', falseTrail: true })
  state.clues.push(falseTrail)
  doAction(state, 'a', 'search')
  doAction(state, 'b', 'search')
  assert.equal(matchView(state, 'a').clues[0].name, 'Footprints heading north')
  assert.equal(matchView(state, 'b').clues[0].name, 'False tracks heading north')
  const believer = state.hunters[1]
  believer.digital.push({ id: randomUUID(), type: 'animalVideo', source: randomUUID() })
  believer.cargo.push({ id: randomUUID(), type: 'feed', source: randomUUID() })
  assert.equal(matchView(state, 'a').player.digital[0].value, 60)
  assert.deepEqual(matchView(state, 'b').player.digital.map(item => item.value), [75, 31])
  doAction(state, 'b', 'submit')
  assert.equal(state.cash, 2216)
})

test('Sasquatch senses the current sector and cardinal neighbors through blocked edges', () => {
  const state = game()
  state.cryptid.pos = 'D3'
  state.cryptid.charges = 1
  const nearby = [device('detector', 'D3'), device('tent', 'E3'), device('camera', 'D2')]
  const diagonal = device('detector', 'E4')
  state.devices.push(...nearby, diagonal)
  const stale = device('snare', 'C3')
  state.cryptid.memories[stale.id] = stale
  cryptidPhase(state)
  assert.equal(MAP.D3.exits.E, undefined)
  doAction(state, 'c', 'ability')
  assert.equal(state.cryptid.charges, 0)
  assert.deepEqual(matchView(state, 'c').devices.map(item => item.id).sort(), nearby.map(item => item.id).sort())
  assert.equal(matchView(state, 'a').cryptid, null)
})

test('Bigfoot sets hidden, non-stacking snares that cancel in-place actions and break on escape', () => {
  const state = game('Bigfoot')
  const [hunter] = state.hunters
  hunter.pos = state.cryptid.pos = 'D6'
  state.cryptid.charges = 2
  cryptidPhase(state)
  doAction(state, 'c', 'ability')
  doAction(state, 'c', 'ability')
  assert.equal(state.cryptid.charges, 0)
  assert.equal(matchView(state, 'a').snares.length, 0)
  assert.equal(matchView(state, 'c').snares.length, 2)
  doAction(state, 'a', 'search')
  const caught = matchView(state, 'a')
  assert.equal(caught.player.ap, 2)
  assert.equal(caught.player.restrained, true)
  assert.deepEqual(caught.moves, [])
  assert.equal(caught.snares.length, 1)
  assert.equal(caught.cryptid, null)
  doAction(state, 'a', 'escape')
  assert.equal(hunter.ap, 1)
  doAction(state, 'a', 'move', CAMP)
  assert.equal(hunter.restraint, null)
  assert.equal(state.cryptidSnares.length, 1)
  hunter.ap = 2
  doAction(state, 'a', 'move', 'D6')
  assert.equal(hunter.ap, 1)
  assert.ok(hunter.restraint)
  doAction(state, 'a', 'escape')
  assert.equal(state.cryptidSnares.length, 0)
})

test('alternate routes link the northwest, eastern ridge, and south of the meadow both ways', () => {
  for (const [first, second] of [['A1', 'A2'], ['F3', 'G3'], ['D5', 'E5']]) {
    assert.ok(Object.values(MAP[first].exits).includes(second))
    assert.ok(Object.values(MAP[second].exits).includes(first))
    const state = game()
    state.hunters[0].pos = first
    doAction(state, 'a', 'move', second)
    assert.equal(state.hunters[0].pos, second)
    state.cryptid.pos = second
    cryptidPhase(state)
    doAction(state, 'c', 'move', first)
    assert.equal(state.cryptid.pos, first)
  }
})

test('hunters get neither hidden Cryptid coordinates nor undiscovered wildlife; Cryptid cannot detect stationary hunter activity', () => {
  const state = game()
  equip(state.hunters[1], 'tent')
  assert.equal(matchView(state, 'a').cryptid, null)
  assert.deepEqual(matchView(state, 'a').animals, [])
  state.cryptid.pos = CAMP
  const before = JSON.stringify(matchView(state, 'c'))
  doAction(state, 'a', 'search')
  doAction(state, 'b', 'deploy', 'tent')
  doAction(state, 'a', 'buy', 'tag')
  assert.equal(JSON.stringify(matchView(state, 'c')), before)
  assert.equal(matchView(state, 'a').cryptid.live, true)
})

test('a harvested animal rendered to the Cryptid moves alongside its hunter without its cargo state', () => {
  const state = game()
  const animal = state.animals[0]
  animal.pos = CAMP
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'hunt', animal.id)
  state.hunters[0].ap = 1
  doAction(state, 'a', 'move', 'D6')
  assert.deepEqual(matchView(state, 'c').animals.find(item => item.id === animal.id),
    { id: animal.id, species: 'rabbit', name: 'Rabbit', pos: 'D6', status: 'alive', live: true })
})

test('site services work with zero actions, respect capacity, and share sale counters across sites', () => {
  const state = game()
  const a = state.hunters[0]
  const b = state.hunters[1]
  equip(a, 'netgun', 'camera', 'kit')
  a.ap = 0
  b.pos = 'D6'
  const tent = device('tent', b.pos)
  state.devices.push(tent)
  const start = state.cash
  doAction(state, 'a', 'buy', 'snare')
  const bought = state.cache.gear[0]
  assert.throws(() => doAction(state, 'a', 'takeGear', bought.id), RuleError)
  assert.equal(bought.qty, 3)
  doAction(state, 'a', 'swapGear', bought.id, { with: a.gear[2].id })
  assert.equal(a.gear[2].id, bought.id)
  const photo = evidence('sighting', CAMP, 1)
  b.digital.push({ id: randomUUID(), type: 'sighting', source: photo.id })
  a.digital.push({ id: randomUUID(), type: 'sighting', source: photo.id })
  doAction(state, 'b', 'submit')
  doAction(state, 'a', 'submit')
  assert.equal(state.cash, start - GEAR.snare.price + 180 + 115)
  assert.equal(a.ap, 0)
  assert.throws(() => doAction(state, 'b', 'sellMeat'), /only be sold at base camp/)
})

test('a free carcass drop shows up as wildlife for the Cryptid, which can feed on it locally', () => {
  const state = game()
  const hunter = state.hunters[0]
  const animal = state.animals[0]
  animal.pos = hunter.pos
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'hunt', animal.id)
  assert.equal(hunter.ap, 0)
  const drop = matchView(state, 'a').actions.find(action => action.type === 'dropCargo')
  assert.equal(drop?.target, animal.id)
  doAction(state, 'a', drop.type, drop.target)
  assert.equal(hunter.ap, 0)
  assert.equal(animal.status, 'ground')
  assert.equal(animal.pos, hunter.pos)
  assert.deepEqual(hunter.cargo, [])
  assert.throws(() => doAction(state, 'a', 'takeGround', animal.id), /no actions left/)
  state.cryptid.pos = 'D6'
  cryptidPhase(state)
  const marker = { id: animal.id, species: 'rabbit', name: 'Rabbit', pos: CAMP, live: true, status: 'alive' }
  assert.deepEqual(matchView(state, 'c').animals.find(item => item.id === animal.id), marker)
  assert.throws(() => doAction(state, 'c', 'feed', animal.id), /no such food/)
  doAction(state, 'c', 'move', CAMP)
  const arrived = matchView(state, 'c')
  assert.deepEqual(arrived.animals.find(item => item.id === animal.id), marker)
  assert.ok(arrived.actions.some(action => action.type === 'feed' && action.target === animal.id))
  doAction(state, 'c', 'feed', animal.id)
  assert.equal(matchView(state, 'c').animals.find(item => item.id === animal.id), undefined)
})

test('destroying a tent drops its carcasses and consuming one cannot pay twice', () => {
  const state = game()
  state.cryptid.pos = CAMP
  const tent = device('tent', 'D6')
  const animal = state.animals[0]
  Object.assign(animal, { pos: tent.pos, status: 'cached', owner: tent.id })
  tent.cargo.push(animal)
  tent.gear.push({ id: randomUUID(), type: 'tag', qty: 1 })
  state.devices.push(tent)
  assert.ok(!matchView(state, 'c').animals.some(item => item.id === animal.id))
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  doAction(state, 'c', 'destroy', tent.id)
  assert.equal(animal.status, 'ground')
  assert.equal(state.devices.length, 0)
  assert.equal(matchView(state, 'c').animals.find(item => item.id === animal.id)?.status, 'alive')
  cryptidPhase(state)
  state.cryptid.hunger = 4
  doAction(state, 'c', 'feed', animal.id)
  assert.equal(animal.status, 'consumed')
  assert.equal(state.cryptid.hunger, 2)
  assert.throws(() => doAction(state, 'c', 'feed', animal.id), RuleError)
})

test('camera shows current occupants, keeps a last sighting, and still requires footage retrieval', () => {
  const state = game()
  equip(state.hunters[0], 'netgun')
  equip(state.hunters[1], 'camera')
  state.cryptid.pos = CAMP
  const rabbit = state.animals[0]
  rabbit.pos = CAMP
  doAction(state, 'b', 'deploy', 'camera')
  const view = matchView(state, 'a')
  assert.equal(view.devices[0].activated, 1)
  assert.deepEqual(view.cryptid, { pos: CAMP, live: true, restrained: false, name: 'Sasquatch' })
  assert.ok(view.animals.some(animal => animal.id === rabbit.id && animal.live))
  assert.ok(view.actions.some(action => action.type === 'hunt' && action.target === rabbit.id))
  assert.ok(view.actions.some(action => action.type === 'shoot'))
  assert.equal(view.player.digital.length, 0)
  assert.equal(Object.hasOwn(view.devices[0], 'occupants'), false)
  cryptidPhase(state)
  doAction(state, 'c', 'mislead', 'E')
  rabbit.pos = 'C7'
  doAction(state, 'c', 'move', 'E7')
  const after = matchView(state, 'a')
  assert.equal(after.devices[0].activated, null)
  assert.deepEqual(after.cryptid, { pos: CAMP, round: 1, live: false, name: 'Sasquatch' })
  assert.ok(!after.animals.some(animal => animal.id === rabbit.id))
  assert.ok(!after.clues.some(clue => clue.type === 'tracks'))
  doAction(state, 'a', 'move', 'C7')
  doAction(state, 'a', 'move', CAMP)
  const tapes = matchView(state, 'a').player.digital
  assert.deepEqual(tapes.map(item => [item.type, item.video, item.value]),
    [['animalVideo', true, 25], ['cryptidVideo', true, 135], ['behaviorVideo', true, 220]])
  assert.deepEqual(state.devices[0].recordings, [])
})

test('a camera records a same-turn pass-through at the camera while a detector stays anonymous', () => {
  const state = game()
  state.animals = []
  state.cryptid.pos = 'D6'
  const camera = device('camera', 'D5')
  const detector = device('detector', 'D4')
  state.devices.push(camera, detector)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D5')
  assert.equal(matchView(state, 'a').cryptid.live, true)
  doAction(state, 'c', 'move', 'D4')
  const view = matchView(state, 'b')
  assert.equal(detector.activated, 1)
  assert.equal(camera.activated, null)
  assert.deepEqual(view.cryptid, { pos: 'D5', round: 1, live: false, name: 'Sasquatch' })
  assert.deepEqual(camera.recordings.map(tape => tape.type), ['cryptidVideo'])
})

test('losing the last camera in a tile ends a camera-only sighting', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  const first = device('camera', 'D5')
  const second = device('camera', 'D5')
  state.devices.push(first, second)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D5')
  doAction(state, 'c', 'destroy', first.id)
  assert.equal(matchView(state, 'a').cryptid.live, true)
  cryptidPhase(state)
  doAction(state, 'c', 'destroy', second.id)
  const view = matchView(state, 'a')
  assert.deepEqual(view.cryptid, { pos: 'D5', round: 2, live: false, name: 'Sasquatch' })
  assert.ok(view.devices.every(item => item.activated == null))
})

test('hunter map highlights the newest active clue round without hiding clue history', () => {
  const state = game()
  state.round = 10
  const discovery = { round: 10, exact: false }
  const old = evidence('tracks', 'D5', 6, { discovery })
  const expired = evidence('tracks', 'D4', 3, { discovery })
  const recent = evidence('tracks', 'D6', 9, { discovery })
  const sameRound = evidence('feed', CAMP, 9, { discovery })
  const collected = evidence('feed', 'C7', 10, { discovery, collected: true })
  const hidden = evidence('tracks', 'E7', 10)
  state.clues.push(old, expired, recent, sameRound, collected, hidden)
  const { clues } = matchView(state, 'a')
  assert.deepEqual(clues.filter(clue => clue.onMap).map(clue => clue.id), [sameRound.id, recent.id])
  assert.deepEqual(clues.map(clue => clue.id), [collected.id, sameRound.id, recent.id, expired.id, old.id])
  assert.equal(clues.find(clue => clue.id === old.id).date, 'Cold')
})

test('a snare alerts anonymously until an arriving hunter confirms and captures its Cryptid', () => {
  const state = game()
  const trap = device('snare', 'D6')
  state.devices.push(trap)
  state.cryptid.pos = CAMP
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  assert.equal(state.cryptid.restraint.device, trap.id)
  const view = matchView(state, 'a')
  assert.equal(view.cryptid, null)
  assert.deepEqual(view.devices[0], { id: trap.id, type: 'snare', pos: 'D6', activated: 1 })
  assert.equal(view.logs[0].message, 'Snare activated at D6.')
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  assert.deepEqual(matchView(state, 'b').cryptid, { pos: 'D6', live: true, restrained: true, name: 'Sasquatch' })
  assert.ok(matchView(state, 'a').actions.some(action => action.type === 'capture'))
  doAction(state, 'a', 'capture')
  assert.equal(state.winner, 'hunters')
})

test('entering an occupied snare tile reveals trapped wildlife for the team and allows an immediate hunt', () => {
  const state = game()
  const [planter, visitor] = state.hunters
  const [rabbit, otherRabbit] = state.animals
  planter.pos = rabbit.pos = 'D6'
  equip(planter, 'snare')
  doAction(state, 'a', 'deploy', 'snare')
  otherRabbit.pos = 'D6'
  assert.equal(matchView(state, 'b').animals.length, 0)
  doAction(state, 'b', 'move', 'D6')
  const seen = matchView(state, 'a').animals
  assert.deepEqual(seen.map(animal => [animal.id, animal.live]), [[rabbit.id, true]])
  assert.ok(matchView(state, 'b').actions.some(action => action.type === 'hunt' && action.target === rabbit.id))
  doAction(state, 'b', 'hunt', rabbit.id)
  assert.equal(visitor.cargo[0], rabbit)
  assert.equal(visitor.ap, 0)
})

test('live wildlife stays in a snare, breaks it on an attempted move, and reveals damage only on hunter arrival', () => {
  const state = game()
  const hunter = state.hunters[0]
  const [rabbit, carcass] = state.animals
  rabbit.pos = 'D5'
  Object.assign(carcass, { pos: 'D6', status: 'ground' })
  state.animals = [rabbit, carcass]
  hunter.pos = 'D6'
  equip(hunter, 'snare')
  doAction(state, 'a', 'deploy', 'snare')
  const [trap] = state.devices
  assert.equal(trap.activated, null)
  assert.equal(carcass.snare, undefined)

  function wildlifeTurn(destination) {
    const options = wildlifeWeights(MAP[rabbit.pos], rabbit.species)
    const index = options.findIndex(option => option.pos === destination)
    assert.ok(index >= 0)
    const roll = options.slice(0, index).reduce((sum, option) => sum + option.probability, 0) +
      options[index].probability / 2
    state.random = () => roll
    doAction(state, 'a', 'end')
    doAction(state, 'b', 'end')
  }

  wildlifeTurn('D6')
  assert.equal(rabbit.snare, trap.id)
  const active = matchView(state, 'a').devices[0]
  assert.equal(active.activated, 1)
  doAction(state, 'c', 'end')
  wildlifeTurn('D6')
  assert.equal(rabbit.snare, trap.id)
  assert.ok(state.devices.includes(trap))
  doAction(state, 'c', 'end')
  wildlifeTurn('D5')
  assert.equal(rabbit.snare, null)
  assert.equal(rabbit.pos, 'D6')
  assert.ok(!state.devices.includes(trap))
  assert.deepEqual(matchView(state, 'a').devices[0], active)
  assert.equal(matchView(state, 'a').clues.length, 0)
  assert.ok(!matchView(state, 'c').clues.some(clue => clue.type === 'damage'))

  doAction(state, 'c', 'end')
  doAction(state, 'a', 'search')
  assert.equal(matchView(state, 'a').clues.length, 0)
  doAction(state, 'b', 'move', 'D6')
  const visit = matchView(state, 'b')
  assert.equal(visit.devices[0].broken, true)
  assert.equal(visit.devices[0].activated, undefined)
  assert.equal(visit.clues[0].date, '1 round ago')
  assert.deepEqual(visit.player.digital.map(item => [item.name, item.damageAge]), [['Broken equipment', 1]])
})

test('destroyed gear looks normal to hunters until arrival even when a hunter was there during destruction', () => {
  const state = game()
  const detector = device('detector', CAMP)
  state.devices.push(detector)
  state.cryptid.pos = 'D6'
  cryptidPhase(state)
  doAction(state, 'c', 'move', CAMP)
  const ongoing = matchView(state, 'a').devices[0]
  doAction(state, 'c', 'destroy', detector.id)
  assert.deepEqual(matchView(state, 'a').devices[0], ongoing)
  assert.equal(matchView(state, 'a').clues.filter(clue => clue.type === 'damage').length, 0)
  doAction(state, 'a', 'move', 'C7')
  doAction(state, 'a', 'move', CAMP)
  const evidence = matchView(state, 'a').player.digital
  assert.deepEqual(evidence.map(item => [item.name, item.damageAge]), [['Broken equipment', 1]])
})

test('gas breaks restraint, evacuates without extra AP, and blocks entry for two Cryptid turns', () => {
  const state = game()
  state.cryptid.pos = CAMP
  state.cryptid.restraint = { device: null }
  equip(state.hunters[0], 'gas')
  const animal = state.animals[0]
  animal.pos = CAMP
  doAction(state, 'a', 'gas')
  assert.equal(state.cryptid.restraint, null)
  assert.notEqual(state.cryptid.pos, CAMP)
  assert.equal(state.cryptid.pos, state.hunters[1].pos)
  assert.notEqual(animal.pos, CAMP)
  assert.equal(state.hunters[0].ap, 1)
  assert.equal(state.hunters[1].ap, 2)
  assert.equal(matchView(state, 'a').cryptid.live, true)
  for (let turn = 1; turn <= 2; turn++) {
    doAction(state, 'a', 'end')
    doAction(state, 'b', 'end')
    assert.deepEqual(matchView(state, 'c').gas, [CAMP])
    assert.throws(() => doAction(state, 'c', 'move', CAMP), RuleError)
    doAction(state, 'c', 'end')
  }
  assert.deepEqual(matchView(state, 'a').gas, [])
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', CAMP)
  assert.equal(state.cryptid.pos, CAMP)
})

test('gas still breaks restraint when the Cryptid cannot leave', () => {
  const state = game('Sasquatch', { b: 'ranger' })
  state.cryptid.pos = CAMP
  state.cryptid.restraint = { device: null }
  equip(state.hunters[0], 'gas')
  const [blockaded, ...gassed] = Object.values(MAP[CAMP].exits)
  doAction(state, 'b', 'blockade', blockaded)
  for (const to of gassed) state.gas.set(to, state.round)
  doAction(state, 'a', 'gas')
  assert.equal(state.cryptid.pos, CAMP)
  assert.equal(state.cryptid.restraint, null)
  assert.equal(state.gas.has(CAMP), true)
})

test('both team sizes start with $2,000, no gear, and pay upkeep until the treasury is empty', () => {
  for (const team of [seats, [...seats, { id: 'd', name: 'Morgan', role: 'hunter' }]]) {
    const state = createMatch(team, 'Mothman', () => 0)
    assert.equal(state.cash, 2000)
    assert.ok(state.hunters.every(hunter => hunter.gear.length === 0))
    assert.deepEqual(state.cache.gear, [])
    const limit = Math.ceil(state.cash / state.upkeep)
    for (let round = 1; round <= limit; round++) {
      assert.equal(state.round, round)
      assert.equal(state.winner, null)
      for (const hunter of state.hunters) doAction(state, hunter.id, 'end')
      doAction(state, 'c', 'end')
    }
    assert.equal(state.cash, 0)
    assert.equal(state.winner, 'cryptid')
  }
})

test('wildlife weights renormalize for blocked routes and a fully blocked sector always stays', () => {
  for (const sector of Object.values(MAP)) {
    const choices = wildlifeWeights(sector, 'turkey')
    assert.ok(Math.abs(choices.reduce((total, choice) => total + choice.probability, 0) - 1) < 1e-10)
    for (const choice of choices) assert.ok(choice.dir === 'stay' || MAP[sector.id].exits[choice.dir] === choice.pos)
  }
  assert.deepEqual(wildlifeWeights({ ...MAP.D4, exits: {} }, 'deer').map(choice => [choice.dir, choice.probability]), [['stay', 1]])
})

function roomClient() {
  // Dispatch through Node's HTTP request listener so these checks also run without network access.
  const server = createGameServer()
  return async (method, url, body, token) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(req, { method, url, headers: token ? { authorization: 'Bearer ' + token } : {} })
    let raw = ''
    const res = new Writable({ write(chunk, _, done) { raw += chunk.toString(); done() } })
    res.setHeader = () => {}
    res.writeHead = status => { res.status = status }
    const finished = once(res, 'finish')
    server.emit('request', req, res)
    await finished
    return { status: res.status, body: JSON.parse(raw) }
  }
}

test('role preferences honor volunteers, use flexible players, and break oversubscription ties randomly', () => {
  const cases = [
    { picks: ['hunter', 'cryptid', 'random'], candidates: 1, indices: [1] },
    { picks: ['cryptid', 'cryptid', 'random', 'hunter'], candidates: 2, indices: [0, 1] },
    { picks: ['random', 'hunter', 'random', 'hunter'], candidates: 2, indices: [0, 2] },
    { picks: ['hunter', 'hunter', 'hunter', 'hunter'], candidates: 4, indices: [0, 1, 2, 3] },
    { picks: ['random', 'random', 'random'], candidates: 3, indices: [0, 1, 2] },
  ]
  for (const { picks, candidates, indices } of cases) {
    const players = picks.map(preference => ({ preference }))
    for (const [choice, chosenPlayer] of indices.entries()) {
      assignRoles(players, count => {
        assert.equal(count, candidates)
        return choice
      })
      assert.deepEqual(players.map(player => player.role),
        players.map((_, index) => index === chosenPlayer ? 'cryptid' : 'hunter'))
    }
  }
})

test('lobby launches after unique hunter classes and the Cryptid species are locked', async () => {
  const request = roomClient()
  const first = (await request('POST', '/api/rooms', { name: 'First', role: 'hunter', hunters: 2 })).body
  const base = '/api/rooms/' + first.view.code + '/'
  assert.equal(first.view.player.preference, 'random')
  assert.equal(first.view.player.role, undefined)
  assert.equal((await request('POST', base + 'start', {}, first.token)).status, 409)
  const guests = await Promise.all(['Second', 'Third', 'Fourth', 'Fifth'].map(name =>
    request('POST', base + 'seats', { name })))
  assert.deepEqual(guests.map(result => result.status).sort(), [201, 201, 201, 409])
  const joiners = guests.filter(result => result.status === 201).map(result => result.body)
  const choose = joiners[0]
  await request('POST', base + 'preference', { preference: 'cryptid' }, choose.token)
  const launched = await request('POST', base + 'start', {}, first.token)
  assert.equal(launched.body.stage, 'loadout')
  assert.deepEqual(Object.keys(launched.body.classDetails), ['ranger', 'biker', 'prepper', 'believer', 'trapper'])
  assert.equal(launched.body.players.filter(player => player.role === 'hunter').length, 3)
  assert.equal(launched.body.speciesOptions, undefined)
  assert.equal((await request('POST', base + 'species', { species: 'Bigfoot' }, first.token)).status, 403)
  assert.equal((await request('POST', base + 'preference', { preference: 'hunter' }, choose.token)).status, 409)
  const selection = (await request('GET', base + 'state', null, choose.token)).body
  assert.deepEqual(selection.speciesOptions, ['Sasquatch', 'Bigfoot', 'Mothman'])
  assert.equal((await request('POST', base + 'class', { hunterClass: 'ranger' }, choose.token)).status, 403)
  assert.equal((await request('POST', base + 'species', { species: 'Unknown' }, choose.token)).status, 400)
  const picked = await request('POST', base + 'species', { species: 'Bigfoot' }, choose.token)
  assert.equal(picked.body.chosenSpecies, 'Bigfoot')
  assert.equal(picked.body.match, undefined)
  const rivals = [first, joiners[1]]
  const race = await Promise.all(rivals.map(player => request('POST', base + 'class', { hunterClass: 'ranger' }, player.token)))
  assert.deepEqual(race.map(attempt => attempt.status).sort(), [200, 409])
  const trapper = await request('POST', base + 'class', { hunterClass: 'trapper' }, rivals[race.findIndex(attempt => attempt.status === 409)].token)
  assert.equal(trapper.body.player.hunterClass, 'trapper')
  const cryptidWaiting = (await request('GET', base + 'state', null, choose.token)).body
  const huntersWaiting = cryptidWaiting.players.filter(player => player.role === 'hunter')
  assert.equal(huntersWaiting.filter(player => player.classReady).length, 2)
  assert.ok(huntersWaiting.every(player => !Object.hasOwn(player, 'hunterClass')))
  const ready = await request('POST', base + 'class', { hunterClass: 'prepper' }, joiners[2].token)
  assert.equal(ready.body.match.player.className, 'Prepper')
  assert.equal(ready.body.match.cash, 2200)
  const hunter = (await request('GET', base + 'state', null, first.token)).body.match
  assert.equal(hunter.species, 'Bigfoot')
  assert.equal(hunter.cryptid, null)
  assert.ok(hunter.hunters.some(player => player.className === 'Trapper'))
  const cryptid = (await request('GET', base + 'state', null, choose.token)).body.match
  assert.ok(cryptid.hunters.every(player => !Object.hasOwn(player, 'className')))
  assert.equal((await request('POST', base + 'class', { hunterClass: 'believer' }, first.token)).status, 409)
  assert.equal((await request('POST', base + 'species', { species: 'Mothman' }, choose.token)).status, 409)
})

test('pass and play uses one credential per player and the same selection flow', async () => {
  const request = roomClient()
  const { token, localSeats, view } = (await request('POST', '/api/rooms', { local: true, playerCount: 4 })).body
  const base = '/api/rooms/' + view.code + '/'
  assert.equal(view.stage, 'lobby')
  assert.equal(localSeats.length, 4)
  assert.equal(new Set(localSeats.map(seat => seat.token)).size, 4)
  assert.equal((await request('POST', base + 'seats', { name: 'Guest' })).status, 409)
  const nextSeat = localSeats[1]
  const names = ['  Luna  ', 'Gemini', 'Terra', 'Sol']
  assert.equal((await request('POST', base + 'names', { names }, nextSeat.token)).status, 403)
  assert.equal((await request('POST', base + 'names', { names: ['Luna', ' ', 'Terra', 'Sol'] }, token)).status, 400)
  const unchanged = (await request('GET', base + 'state', null, nextSeat.token)).body
  assert.deepEqual(unchanged.players.map(player => player.name), localSeats.map(player => player.name))
  const renamed = await request('POST', base + 'names', { names }, token)
  assert.equal(renamed.status, 200)
  assert.deepEqual(renamed.body.players.map(player => player.name), ['Luna', 'Gemini', 'Terra', 'Sol'])
  await request('POST', base + 'preference', { preference: 'cryptid' }, nextSeat.token)
  await request('POST', base + 'start', {}, token)
  assert.equal((await request('POST', base + 'names', { names }, token)).status, 409)
  const hunters = localSeats.filter(seat => seat.id !== nextSeat.id)
  for (const [index, hunterClass] of ['ranger', 'believer', 'biker'].entries()) {
    const result = await request('POST', base + 'class', { hunterClass }, hunters[index].token)
    assert.equal(result.body.stage, 'loadout')
  }
  const round = (await request('POST', base + 'species', { species: 'Mothman' }, nextSeat.token)).body.match
  assert.equal(round.player.id, nextSeat.id)
  assert.equal(round.round, 1)
  assert.equal(round.hunters.length, 3)
  assert.equal(round.player.name, 'Gemini')
  assert.deepEqual(round.hunters.map(hunter => hunter.name), ['Luna', 'Terra', 'Sol'])
})

test('LAN URLs reflect the listening address and actual port', () => {
  const adapters = {
    loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.0.1' }],
    wifi: [{ family: 'IPv4', internal: false, address: '192.168.1.2' }],
    ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.2' },
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '10.0.0.4' }],
  }
  assert.deepEqual(lanUrls({ address: '0.0.0.0', port: 3077 }, adapters),
    ['http://192.168.1.2:3077', 'http://10.0.0.4:3077', 'http://172.20.0.1:3077'])
  assert.deepEqual(lanUrls({ address: '127.0.0.1', port: 3000 }, adapters), [])
  assert.deepEqual(lanUrls({ address: '10.0.0.4', port: 3000 }, adapters), ['http://10.0.0.4:3000'])
})

test('room HTTP handlers enforce seats, phase, idempotency, and an atomic cache race', async () => {
  const request = roomClient()
  const first = (await request('POST', '/api/rooms', { name: 'First' })).body
  const base = '/api/rooms/' + first.view.code + '/'
  const second = (await request('POST', base + 'seats', { name: 'Second' })).body
  const cryptid = (await request('POST', base + 'seats', { name: 'Third' })).body
  await request('POST', base + 'preference', { preference: 'cryptid' }, cryptid.token)
  assert.equal((await request('GET', base + 'state')).status, 401)
  assert.equal((await request('POST', base + 'start', {}, second.token)).status, 403)
  assert.equal((await request('POST', base + 'start', {}, first.token)).status, 200)
  assert.equal((await request('POST', base + 'species', { species: 'Sasquatch' }, cryptid.token)).status, 200)
  assert.equal((await request('POST', base + 'class', { hunterClass: 'ranger' }, first.token)).status, 200)
  assert.equal((await request('POST', base + 'class', { hunterClass: 'biker' }, second.token)).status, 200)
  const action = (token, type, target, requestId = randomUUID()) =>
    request('POST', base + 'actions', { type, target, round: 1, requestId }, token)
  const purchaseId = randomUUID()
  const bought = await action(first.token, 'buy', 'tag', purchaseId)
  const replay = await action(first.token, 'buy', 'tag', purchaseId)
  assert.equal(replay.body.match.cash, bought.body.match.cash)
  const pack = bought.body.match.sites[0].gear.find(item => item.type === 'tag')
  const race = await Promise.all([
    action(first.token, 'takeGear', pack.id),
    action(second.token, 'takeGear', pack.id),
  ])
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409])
  const secret = (await request('GET', base + 'state', null, cryptid.token)).body.match
  assert.equal(secret.role, 'cryptid')
  assert.equal(Object.hasOwn(secret, 'cash'), false)
  assert.equal(Object.hasOwn(secret.hunters[0], 'ap'), false)
})
