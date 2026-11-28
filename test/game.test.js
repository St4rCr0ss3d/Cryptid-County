import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { assignRoles, createGameServer, lanUrls } from '../server.js'
import { createMatch, act, RuleError, wildlifeWeights } from '../lib/game.js'
import { matchView, searchView } from '../lib/view.js'
import { MAP, CAMP, GEAR, EVIDENCE } from '../lib/config.js'

const seats = [
  { id: 'a', name: 'Stevie', role: 'hunter' },
  { id: 'b', name: 'Lee', role: 'hunter' },
  { id: 'c', name: 'Creature', role: 'cryptid' },
]
const game = (species = 'Sasquatch', classes = {}) =>
  createMatch(seats.map(player => ({ ...player, hunterClass: classes[player.id] })), species, () => 0)
const doAction = (state, actor, type, target, extra = {}) => act(state, actor, { type, target, ...extra })
const cryptidPhase = state => { state.phase = 'cryptid'; state.cryptid.ap = 2; state.cryptid.movement = 3 }
const device = (type, pos) => ({ id: randomUUID(), type, pos, occupants: [], recordings: [], gear: [], cargo: [], activated: null })
const evidence = (type, pos, round, extra = {}) => ({ id: randomUUID(), type, pos, round, ...extra })
const equip = (hunter, ...types) => hunter.gear.push(...types.map(type => ({ id: randomUUID(), type, qty: GEAR[type].size })))

test('hunter actions interleave and Search, netgun, move, capture ends the match immediately', () => {
  const state = game('Sasquatch')
  for (const hunter of state.hunters) equip(hunter, 'netgun')
  state.hunters[0].pos = state.cryptid.pos = 'D6'
  doAction(state, 'a', 'search')
  doAction(state, 'b', 'move', 'D6')
  doAction(state, 'a', 'shoot')
  const cash = state.cash
  assert.throws(() => doAction(state, 'b', 'shoot'), RuleError)
  assert.equal(state.hunters[1].ap, 3)
  assert.equal(state.hunters[1].gear[0].qty, 2)
  doAction(state, 'b', 'capture')
  assert.equal(state.winner, 'hunters')
  assert.equal(state.cash, cash)
  assert.throws(() => doAction(state, 'a', 'capture'), RuleError)
})

test('manual passes wait for all hunters before wildlife and the Cryptid act; upkeep charges once', () => {
  const state = game()
  assert.equal(matchView(state, 'c').player.hunger, 0)
  doAction(state, 'a', 'search')
  assert.throws(() => doAction(state, 'a', 'search'), /already searched/)
  assert.equal(state.hunters[0].ap, 2)
  assert.equal(state.phase, 'hunters')
  doAction(state, 'a', 'end')
  assert.equal(state.phase, 'hunters')
  doAction(state, 'b', 'end')
  assert.equal(state.phase, 'cryptid')
  assert.equal(matchView(state, 'c').player.hunger, 1)
  const cash = state.cash
  assert.equal(matchView(state, 'c').player.ap, 9)
  doAction(state, 'c', 'end')
  assert.equal(state.phase, 'hunters')
  assert.equal(state.round, 2)
  assert.equal(state.cash, cash - state.upkeep)
  assert.deepEqual(state.hunters.map(({ ap, ended }) => [ap, ended]), [[3, false], [3, false]])
  assert.ok(matchView(state, 'a').actions.some(action => action.type === 'search'))
  doAction(state, 'a', 'search')
})

test('exhausting both budgets passes only that hunter, and the final automatic pass starts Night', () => {
  const state = game()
  const [a, b] = state.hunters
  for (const hunter of [a, b]) hunter.ap = 1

  doAction(state, 'a', 'search')
  assert.equal(a.ap, 0)
  assert.equal(a.ended, false)
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'move', CAMP)
  assert.equal(a.ended, true)
  assert.equal(b.ended, false)
  assert.equal(state.phase, 'hunters')

  doAction(state, 'b', 'move', 'D6')
  doAction(state, 'b', 'move', CAMP)
  assert.equal(b.ended, false)
  doAction(state, 'b', 'search')
  assert.equal(b.ended, true)
  assert.equal(state.phase, 'cryptid')
})

test('undiscovered tracks carry into Day without broadcasting a radio report', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  doAction(state, 'c', 'move', 'D5')
  doAction(state, 'c', 'end')
  assert.ok(state.clues.some(clue => clue.type === 'tracks' && clue.pos === 'D6'))
  const view = matchView(state, 'a')
  assert.equal(Object.hasOwn(view, 'radioReports'), false)
  assert.doesNotMatch(JSON.stringify(view.logs), /radio report/i)
  doAction(state, 'a', 'move', 'D6')
  const findings = doAction(state, 'a', 'search')
  assert.equal(findings.sector, 'D6')
  assert.ok(matchView(state, 'a').player.digital.some(item => item.type === 'tracks'))
})

test('Cryptid entry reveals, escape preserves the sighting, and departure marks the destination', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  cryptidPhase(state)
  doAction(state, 'c', 'move', CAMP)
  assert.equal(matchView(state, 'a').cryptid.pos, CAMP)
  assert.equal(matchView(state, 'a').species, 'Sasquatch')
  state.cryptid.restraint = { device: null }
  doAction(state, 'c', 'escape')
  assert.equal(matchView(state, 'a').cryptid.live, true)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  assert.equal(matchView(state, 'a').cryptid.pos, 'D6')
  assert.equal(matchView(state, 'a').cryptid.live, false)
})

test('a hunter can follow a Cryptid that ran through their space and net it without searching', () => {
  const state = game('Sasquatch')
  state.cryptid.pos = 'D6'
  equip(state.hunters[0], 'netgun')
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', CAMP)
  doAction(state, 'c', 'move', 'C7')
  doAction(state, 'c', 'end')
  const before = matchView(state, 'a')
  assert.equal(before.cryptid.pos, 'C7')
  assert.equal(before.cryptid.live, false)
  assert.equal(before.clues.find(clue => clue.type === 'sighting').pos, CAMP)
  doAction(state, 'a', 'move', 'C7')
  assert.equal(matchView(state, 'b').cryptid.live, true)
  assert.equal(state.hunters[0].ap, 3)
  assert.ok(matchView(state, 'a').actions.some(action => action.type === 'shoot'))
  doAction(state, 'a', 'shoot')
  assert.equal(matchView(state, 'b').cryptid.restrained, true)
  assert.equal(state.hunters[0].ap, 2)
})

test('unseen movement leaves the last-known marker behind and still requires a search', () => {
  const state = game()
  state.cryptid.pos = CAMP
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', 'D6')
  doAction(state, 'c', 'move', 'D5')
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'move', 'D5')
  assert.equal(matchView(state, 'a').cryptid.pos, 'D6')
  assert.equal(matchView(state, 'a').cryptid.live, false)
  assert.equal(state.cryptid.seen, null)
})

test('snares interrupt in-space interactions for free and wipe out remaining movement', () => {
  const state = game()
  state.cryptid.pos = CAMP
  const traps = [device('anchor', 'D6'), device('anchor', 'D6')]
  const tent = device('tent', 'D6')
  state.devices.push(...traps, tent)
  cryptidPhase(state)
  state.cryptid.ap = 4
  doAction(state, 'c', 'move', 'D6')
  assert.equal(state.cryptid.restraint.device, traps[0].id)
  doAction(state, 'c', 'escape')
  assert.equal(state.cryptid.restraint, null)
  doAction(state, 'c', 'destroy', tent.id)
  assert.ok(state.devices.includes(tent))
  assert.equal(state.cryptid.ap, 2)
  assert.equal(state.cryptid.restraint.device, traps[1].id)
  doAction(state, 'c', 'escape')
  assert.equal(state.cryptid.movement, 0)
  assert.throws(() => doAction(state, 'c', 'move', CAMP), /no movement left/)
  doAction(state, 'c', 'end')
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  assert.equal(state.cryptid.movement, 3)
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
  doAction(state, 'c', 'end')
  assert.equal(state.round, 2)
  assert.deepEqual(matchView(state, 'a').animals[0], { ...signal, pos: 'E5' })
  assert.equal(matchView(state, 'a').cryptid, null)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', 'E6')
  assert.deepEqual(matchView(state, 'a').animals[0], { ...signal, pos: 'E6' })
  doAction(state, 'c', 'move', 'E7')
  doAction(state, 'c', 'end')
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
  assert.equal(recovered.player.ap, 3)
  assert.deepEqual(recovered.player.digital.map(({ name, photo, value }) => [name, photo, value]),
    [['Scat evidence', true, 110]])
  assert.deepEqual(recovered.animals, [])
  assert.equal(recovered.cryptid, null)
  doAction(state, 'b', 'move', 'E7')
  assert.deepEqual(matchView(state, 'b').player.digital, [])
  assert.deepEqual(matchView(state, 'c').logs, cryptidLog)
  assert.ok(!cryptidLog.some(entry => /scat|tag/.test(entry.message)))
})

test('Search lists surviving visits with precise age and an authentic track pattern', () => {
  const state = game()
  equip(state.hunters[0], 'kit')
  state.round = 8
  const old = evidence('tracks', CAMP, 1, { dir: 'W' })
  const fake = evidence('tracks', CAMP, 5, { dir: 'N', falseTrail: true })
  const real = evidence('tracks', CAMP, 7, { dir: 'E' })
  state.clues.push(old, fake, real)
  doAction(state, 'b', 'search')
  const basic = matchView(state, 'a').clues
  assert.deepEqual(basic.map(clue => clue.date), ['Fresh', 'Cold'])
  doAction(state, 'a', 'search')
  assert.equal(matchView(state, 'a').clues[0].name, 'Sasquatch tracks east')
  const precise = matchView(state, 'b').clues
  assert.deepEqual(precise.map(clue => [clue.name, clue.date]), [
    ['Cryptid tracks east', 'Fresh'], ['Cryptid tracks north', '3 rounds ago'],
  ])
  assert.deepEqual(Object.keys(precise[0]), Object.keys(precise[1]))
  assert.equal(precise.some(clue => Object.hasOwn(clue, 'falseTrail')), false)
})

test('Search grants one paid photo per clue across the team', () => {
  const state = game()
  state.cryptid.pos = CAMP
  state.clues.push(evidence('tracks', CAMP, 1, { dir: 'N' }), evidence('feed', CAMP, 1))
  doAction(state, 'a', 'search')
  const original = matchView(state, 'a').player.digital
  assert.deepEqual(original.map(({ type, value }) => [type, value]),
    [['tracks', 60], ['feed', 110], ['sighting', 180]])
  assert.ok(original.every(item => item.photo))
  assert.equal(state.hunters[0].cargo.length, 0)
  assert.throws(() => doAction(state, 'a', 'search'), /already searched/)
  assert.deepEqual(matchView(state, 'a').player.digital, original)
  const target = state.clues.find(clue => clue.type === 'tracks').id
  assert.ok(!matchView(state, 'b').actions.some(action => action.type === 'photo' && action.target === target))
  assert.throws(() => doAction(state, 'b', 'photo', target), /already been photographed/)
  assert.equal(state.hunters[1].ap, 3)
  const secondSearch = doAction(state, 'b', 'search')
  assert.equal(secondSearch.clueIds.length, 3)
  assert.deepEqual(matchView(state, 'b').player.digital, [])
  const before = state.cash
  doAction(state, 'a', 'submit')
  assert.equal(state.cash - before, original.reduce((sum, item) => sum + item.value, 0))
  assert.throws(() => doAction(state, 'b', 'photo', target), /already been photographed/)
})

test('Search without saleable evidence produces no photos or funding', () => {
  const state = game()
  const cash = state.cash
  state.devices.push(device('detector', CAMP))
  doAction(state, 'a', 'search')
  state.clues.push(evidence('animalTracks', 'D6', 1, { dir: 'N', animalSpecies: 'rabbit' }))
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'move', CAMP)
  assert.ok(matchView(state, 'a').clues.some(item => item.name === 'Rabbit tracks heading north'))
  assert.ok(!matchView(state, 'c').clues.some(item => item.type === 'animalTracks'))
  assert.deepEqual(matchView(state, 'a').player.digital, [])
  assert.throws(() => doAction(state, 'a', 'submit'), /no evidence/)
  assert.equal(state.cash, cash)
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
  assert.equal(state.cash, 2600 + player.cargo[0].value + player.digital[0].value)
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

test('signature powers use only AP and charge pickups are absent', () => {
  const state = game('Mothman')
  state.cryptid.pos = 'D6'
  cryptidPhase(state)
  state.cryptid.ap = 3
  assert.equal(Object.hasOwn(state, 'chargeGrowths'), false)
  assert.equal(matchView(state, 'c').player.charges, undefined)
  assert.ok(!matchView(state, 'c').actions.some(item => item.type === 'ability'))
  assert.throws(() => doAction(state, 'c', 'ability', 'N'), /enough AP/)
  state.cryptid.ap = 4
  doAction(state, 'c', 'ability', 'N')
  assert.equal(state.cryptid.pos, 'D4')
  assert.equal(state.cryptid.ap, 0)
})

test('Mothman flies past blocked routes and intermediate hazards but resolves the landing', () => {
  const state = game('Mothman')
  state.cryptid.pos = 'B2'
  state.hunters[0].pos = 'C2'
  state.hunters[1].pos = 'D2'
  const middle = device('snare', 'C2')
  const landing = device('aerial', 'D2')
  const camera = device('camera', 'B2')
  state.devices.push(middle, landing, camera, { ...device('blockade', 'C2'), to: 'D2' })
  cryptidPhase(state)
  state.cryptid.ap = 6
  assert.equal(MAP.B2.exits.E, undefined)
  assert.throws(() => doAction(state, 'c', 'ability', 'W'), RuleError)
  state.gas.set('D2', state.round)
  assert.throws(() => doAction(state, 'c', 'ability', 'E'), RuleError)
  assert.equal(state.cryptid.ap, 6)
  state.gas.delete('D2')
  state.gas.set('C2', state.round)
  doAction(state, 'c', 'ability', 'E')
  assert.equal(state.cryptid.pos, 'D2')
  assert.equal(state.cryptid.ap, 2)
  assert.equal(state.cryptid.restraint.device, landing.id)
  assert.equal(state.cryptid.movement, 0)
  doAction(state, 'c', 'escape')
  assert.deepEqual(matchView(state, 'c').moves, [])
  assert.equal(matchView(state, 'a').cryptid.pos, 'D2')
  assert.ok(state.devices.includes(middle))
  assert.ok(!state.clues.some(clue => clue.type === 'tracks'))
  assert.equal(camera.recordings[0].type, 'behaviorVideo')
})

test('the Habitat Surveyor can recover permanent trail blockades from either end', () => {
  const state = game('Sasquatch', { a: 'ranger' })
  state.cryptid.pos = CAMP
  assert.ok(matchView(state, 'a').blockadeTargets.includes('D6'))
  assert.deepEqual(matchView(state, 'b').blockadeTargets, [])
  assert.throws(() => doAction(state, 'a', 'blockade', 'D4'), RuleError)
  doAction(state, 'a', 'blockade', 'D6')
  assert.equal(matchView(state, 'a').player.ap, 2)
  doAction(state, 'a', 'blockade', 'C7')
  assert.equal(matchView(state, 'a').player.ap, 1)
  assert.equal(matchView(state, 'a').player.blockades, 0)
  assert.deepEqual(matchView(state, 'a').blockadeTargets, [])
  const [north, west] = state.devices
  assert.throws(() => doAction(state, 'b', 'recover', north.id), /blockade specialist/)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  assert.ok(!matchView(state, 'c').moves.includes('D6'))
  assert.throws(() => doAction(state, 'c', 'move', 'D6'), RuleError)
  assert.equal(state.cryptid.ap, 9)
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
  assert.ok(!matchView(state, 'c').actions.some(action => action.type === 'destroy' && action.target === west.id))
  assert.throws(() => doAction(state, 'c', 'destroy', west.id), /cannot be destroyed/)
  state.cryptid.ultimateUnlocked = true
  doAction(state, 'c', 'ultimate')
  assert.ok(state.devices.includes(west))
  assert.equal(matchView(state, 'a').player.blockades, 1)
  assert.ok(matchView(state, 'a').devices.some(item => item.id === west.id && !item.broken))
})

test('the Trail Biker pays AP to mount or dismount and keeps movement spent across both modes', () => {
  const state = game('Sasquatch', { a: 'biker' })
  const biker = () => matchView(state, 'a').player
  assert.equal(biker().movement, 2)
  assert.equal(biker().bikePos, CAMP)
  assert.equal(matchView(state, 'b').hunters[0].bikePos, CAMP)
  assert.equal(Object.hasOwn(matchView(state, 'c').hunters[0], 'bikePos'), false)
  assert.throws(() => doAction(state, 'b', 'toggleBike'), /Only the Field Mobility Specialist/)
  doAction(state, 'a', 'toggleBike')
  assert.equal(biker().movement, 4)
  assert.equal(matchView(state, 'b').hunters[0].bikePos, null)
  assert.equal(biker().ap, 2)
  for (const target of ['D6', 'D5', 'D4']) doAction(state, 'a', 'move', target)
  assert.equal(biker().movement, 1)
  assert.equal(biker().ap, 2)
  doAction(state, 'a', 'toggleBike')
  assert.equal(biker().bikePos, 'D4')
  assert.equal(matchView(state, 'b').hunters[0].bikePos, 'D4')
  assert.equal(biker().movement, 0)
  assert.equal(biker().ap, 1)
  doAction(state, 'a', 'toggleBike')
  assert.equal(biker().movement, 1)
  assert.equal(biker().ap, 0)
  for (const actor of ['a', 'b', 'c']) doAction(state, actor, 'end')
  assert.equal(biker().movement, 4)
  doAction(state, 'a', 'toggleBike')
  doAction(state, 'a', 'move', 'D3')
  assert.equal(biker().movement, 1)
  assert.throws(() => doAction(state, 'a', 'toggleBike'), /Return to the parked bike/)
  doAction(state, 'a', 'move', 'D4')
  doAction(state, 'a', 'toggleBike')
  assert.equal(biker().movement, 2)
  state.cryptidSnares.push({ id: randomUUID(), pos: 'D3', discovered: false })
  doAction(state, 'a', 'move', 'D3')
  assert.equal(biker().restrained, false)
  assert.equal(biker().movement, 1)
  assert.equal(state.cryptidSnares[0].activated, undefined)
})

test('the Prepper starts with a loaded netgun, four slots and $200 extra team cash', () => {
  const state = game('Sasquatch', { a: 'prepper' })
  const hunter = state.hunters[0]
  assert.equal(state.cash, 2800)
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

test('the Trapper starts with an anchored snare and can deploy one per round at zero AP', () => {
  const state = game('Sasquatch', { a: 'trapper' })
  const [trapper, teammate] = state.hunters
  const deploySnare = () => matchView(state, 'a').actions.find(action => action.type === 'deploy' && action.target === 'snare')
  assert.deepEqual(trapper.gear.map(({ type, qty }) => [type, qty]), [['anchor', 1]])
  equip(trapper, 'snare', 'detector')
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'search')
  for (let i = 0; i < 2; i++) doAction(state, 'a', 'deploy', 'detector')
  assert.equal(deploySnare()?.label, 'Deploy snare · 0 AP')
  doAction(state, 'a', 'deploy', 'snare')
  assert.equal(state.devices.find(item => item.type === 'snare').pos, 'D6')
  assert.equal(trapper.ap, 0)
  assert.equal(trapper.gear.find(pack => pack.type === 'snare').qty, 2)
  assert.equal(deploySnare(), undefined)
  assert.throws(() => doAction(state, 'a', 'deploy', 'snare'), /not have enough AP/)

  equip(teammate, 'snare')
  doAction(state, 'b', 'deploy', 'snare')
  assert.equal(teammate.ap, 2)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'end')
  assert.equal(deploySnare()?.label, 'Deploy snare · 0 AP')
  doAction(state, 'a', 'deploy', 'snare')
  assert.equal(trapper.ap, 3)
  assert.equal(deploySnare()?.label, 'Deploy snare')
  doAction(state, 'a', 'deploy', 'snare')
  assert.equal(trapper.ap, 2)
  assert.equal(trapper.gear.some(pack => pack.type === 'snare'), false)
})

test('the True Believer privately identifies false tracks and earns 25% more on photos and tapes', () => {
  const state = game('Sasquatch', { b: 'believer' })
  const falseTrail = evidence('tracks', CAMP, 1, { dir: 'N', falseTrail: true })
  state.clues.push(falseTrail)
  doAction(state, 'b', 'search')
  doAction(state, 'a', 'search')
  assert.equal(matchView(state, 'a').clues[0].name, 'Cryptid tracks north')
  assert.equal(matchView(state, 'b').clues[0].name, 'False Sasquatch tracks north')
  const believer = state.hunters[1]
  believer.digital.push({ id: randomUUID(), type: 'animalVideo', source: randomUUID() })
  believer.cargo.push({ id: randomUUID(), type: 'feed', source: randomUUID() })
  assert.deepEqual(matchView(state, 'a').player.digital, [])
  assert.deepEqual(matchView(state, 'b').player.digital.map(item => item.value), [75, 31])
  doAction(state, 'b', 'submit')
  assert.equal(state.cash, 2816)
})

test('Sasquatch passively senses eight neighboring sectors through blocked edges', () => {
  const state = game()
  state.cryptid.pos = 'D3'
  const nearby = [device('detector', 'D3'), device('tent', 'E3'), device('camera', 'D2'), device('detector', 'E4')]
  state.devices.push(...nearby, device('detector', 'E5'))
  const stale = device('snare', 'C3')
  state.cryptid.memories[stale.id] = stale
  assert.equal(MAP.D3.exits.E, undefined)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  const view = matchView(state, 'c')
  assert.equal(view.player.ap, 9)
  assert.deepEqual(view.devices.map(item => item.id).sort(), nearby.map(item => item.id).sort())
  assert.ok(view.devices.every(item => !item.remembered))
  assert.ok(!view.actions.some(item => item.type === 'ability'))
  assert.throws(() => doAction(state, 'c', 'ability'), /automatically/)
  assert.equal(matchView(state, 'a').cryptid, null)
})


test('cryptids can place one shared AP-funded snare per Night', () => {
  const state = game('Mimic')
  const [hunter] = state.hunters
  hunter.pos = state.cryptid.pos = 'D6'
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  doAction(state, 'c', 'setSnare')
  assert.equal(state.cryptid.ap, 5)
  assert.throws(() => doAction(state, 'c', 'setSnare'), /one snare/)
  assert.equal(matchView(state, 'a').snares.length, 0)
  assert.equal(matchView(state, 'c').snares.length, 1)
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'search')
  const caught = matchView(state, 'a')
  assert.equal(caught.player.ap, 3)
  assert.equal(caught.player.restrained, true)
  assert.deepEqual(caught.moves, [])
  assert.equal(caught.snares.length, 1)
  assert.equal(caught.cryptid, null)
  doAction(state, 'a', 'escape')
  assert.equal(hunter.ap, 1)
  assert.equal(matchView(state, 'a').player.movement, 0)
  assert.throws(() => doAction(state, 'a', 'move', CAMP), /no movement left/)
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
  const state = game('Mothman')
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
  const state = createMatch(seats, 'Sasquatch', () => 0, 'hunters')
  equip(state.hunters[0], 'rifle')
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
  const state = createMatch(seats, 'Sasquatch', () => 0, 'hunters')
  const hunter = state.hunters[0]
  equip(state.hunters[0], 'rifle')
  const animal = state.animals[0]
  animal.pos = hunter.pos
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'hunt', animal.id)
  equip(hunter, 'rifleAmmo')
  doAction(state, 'a', 'reload', hunter.gear.find(item => item.type === 'rifle').id)
  assert.equal(hunter.ap, 0)
  const drop = matchView(state, 'a').actions.find(action => action.type === 'dropCargo')
  assert.equal(drop?.target, animal.id)
  doAction(state, 'a', drop.type, drop.target)
  assert.equal(hunter.ap, 0)
  assert.equal(animal.status, 'ground')
  assert.equal(animal.pos, hunter.pos)
  assert.deepEqual(hunter.cargo, [])
  assert.throws(() => doAction(state, 'a', 'takeGround', animal.id), /not have enough AP/)
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

test('cameras record silently and only their deployer can spend AP to check live occupants', () => {
  const state = game()
  equip(state.hunters[1], 'camera')
  state.cryptid.pos = 'D6'
  const rabbit = state.animals[0]
  rabbit.pos = 'D6'
  doAction(state, 'b', 'move', 'D6')
  doAction(state, 'b', 'deploy', 'camera')
  doAction(state, 'b', 'move', CAMP)
  const [camera] = state.devices
  assert.equal(camera.activated, null)
  assert.equal(matchView(state, 'a').cryptid, null)
  assert.equal(matchView(state, 'a').animals.length, 0)
  assert.equal(matchView(state, 'a').actions.some(action => action.type === 'checkCamera'), false)
  assert.throws(() => doAction(state, 'a', 'checkCamera', camera.id), /who deployed/)
  assert.equal(matchView(state, 'b').actions.find(action => action.type === 'checkCamera').signal, true)
  state.clues.push(evidence('tracks', 'D6', 1, { dir: 'N' }))
  const findings = doAction(state, 'b', 'checkCamera', camera.id)
  assert.equal(findings.sector, 'D6')
  assert.equal(state.hunters[1].ap, 0)
  assert.equal(matchView(state, 'a').cryptid.pos, 'D6')
  assert.ok(matchView(state, 'a').animals.some(item => item.id === rabbit.id && item.live))
  assert.deepEqual(matchView(state, 'b').player.digital.map(item => item.type).sort(), ['sighting', 'tracks'])
  assert.equal(camera.checkedVersion, camera.recordingVersion)
  assert.equal(state.hunters[1].ended, true)
  doAction(state, 'a', 'end')
  assert.equal(matchView(state, 'a').cryptid.live, false)
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  assert.ok(matchView(state, 'a').player.digital.some(item => item.type === 'cryptidVideo'))
})


test('a camera records a same-turn pass-through without alerting or revealing the Cryptid', () => {
  const state = game()
  state.animals = []
  state.cryptid.pos = 'D6'
  const camera = device('camera', 'D5')
  const detector = device('detector', 'D4')
  state.devices.push(camera, detector)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D5')
  assert.equal(matchView(state, 'a').cryptid, null)
  doAction(state, 'c', 'move', 'D4')
  assert.equal(detector.activated, 1)
  assert.equal(matchView(state, 'b').logs.find(item => item.message.includes('Motion detector activated')).equipmentAlert, true)
  assert.equal(camera.activated, null)
  assert.equal(matchView(state, 'b').cryptid, null)
  assert.deepEqual(camera.recordings.map(tape => tape.type), ['cryptidVideo'])
})


test('camera searches spend 2 AP and count toward the player’s daily sector limit', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  const first = { ...device('camera', 'D5'), owner: 'a' }
  const second = { ...device('camera', 'D6'), owner: 'a' }
  state.devices.push(first, second)
  doAction(state, 'a', 'checkCamera', first.id)
  assert.equal(state.hunters[0].ap, 1)
  assert.equal(matchView(state, 'b').cryptid, null)
  assert.throws(() => doAction(state, 'a', 'checkCamera', second.id), /enough AP/)
  for (const actor of ['a', 'b', 'c']) doAction(state, actor, 'end')
  doAction(state, 'a', 'checkCamera', second.id)
  assert.equal(state.hunters[0].ap, 1)
  doAction(state, 'a', 'move', 'D6')
  assert.throws(() => doAction(state, 'a', 'search'), /already searched/)
  assert.equal(matchView(state, 'b').cryptid.pos, 'D6')
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

test('an expedition member must search a trap alert before confirming its Cryptid', () => {
  const state = game()
  const trap = device('anchor', 'D6')
  state.devices.push(trap)
  state.cryptid.pos = CAMP
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  assert.equal(state.cryptid.restraint.device, trap.id)
  const view = matchView(state, 'a')
  assert.equal(view.cryptid, null)
  assert.deepEqual(view.devices[0], { id: trap.id, type: 'anchor', pos: 'D6', activated: 1 })
  assert.equal(view.logs[0].message, 'Snare activated at D6.')
  assert.equal(view.logs[0].equipmentAlert, true)
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  assert.equal(matchView(state, 'b').cryptid, null)
  assert.equal(trap.activated, 1)
  doAction(state, 'a', 'search')
  assert.equal(trap.activated, null)
  assert.deepEqual(matchView(state, 'b').cryptid, { pos: 'D6', live: true, restrained: true, name: 'Sasquatch' })
  assert.ok(matchView(state, 'a').actions.some(action => action.type === 'capture'))
  doAction(state, 'a', 'capture')
  assert.equal(state.winner, 'hunters')
})

test('searching an occupied snare sector reveals wildlife and lets Hunters harvest it', () => {
  const state = createMatch(seats, 'Sasquatch', () => 0, 'hunters')
  const [planter, visitor] = state.hunters
  const [rabbit, otherRabbit] = state.animals
  planter.pos = rabbit.pos = 'D6'
  equip(planter, 'snare')
  doAction(state, 'a', 'deploy', 'snare')
  otherRabbit.pos = 'D6'
  assert.deepEqual(matchView(state, 'b').animals, [])
  doAction(state, 'b', 'move', 'D6')
  assert.deepEqual(matchView(state, 'b').animals, [])
  doAction(state, 'b', 'search')
  assert.ok(matchView(state, 'a').animals.some(animal => animal.id === rabbit.id && animal.live))
  assert.ok(matchView(state, 'b').actions.some(action => action.type === 'hunt' && action.target === rabbit.id))
  doAction(state, 'b', 'hunt', rabbit.id)
  assert.equal(visitor.cargo[0], rabbit)
  assert.equal(visitor.ap, 1)
})

test('rabbits stay snared, turkeys roll a 25 percent escape, and deer escape on the next wildlife turn', () => {
  for (const [species, roll, breaks] of [['rabbit', 0, false], ['turkey', .24, true], ['turkey', .25, false], ['deer', .99, true]]) {
    const state = game()
    const animal = state.animals.find(item => item.species === species)
    const carcass = state.animals.find(item => item !== animal)
    animal.pos = 'D6'
    Object.assign(carcass, { pos: 'D6', status: 'ground' })
    state.animals = [animal, carcass]
    state.hunters[0].pos = 'D6'
    state.random = () => roll
    equip(state.hunters[0], 'snare')
    doAction(state, 'a', 'deploy', 'snare')
    const [trap] = state.devices
    assert.equal(animal.snare, trap.id)
    assert.equal(carcass.snare, undefined)
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    assert.equal(animal.snare, breaks ? null : trap.id)
    assert.equal(animal.pos, 'D6')
    assert.equal(state.devices.includes(trap), !breaks)
    if (breaks) {
      assert.equal(matchView(state, 'a').clues.length, 0)
      doAction(state, 'c', 'end')
      doAction(state, 'b', 'move', 'D6')
      assert.ok(matchView(state, 'a').clues.some(clue => clue.type === 'damage'))
    }
  }
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
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'C7')
  doAction(state, 'a', 'move', CAMP)
  const evidence = matchView(state, 'a').player.digital
  assert.deepEqual(evidence.map(item => [item.name, item.damageAge]), [['Broken equipment', 1]])
  assert.ok(matchView(state, 'a').logs.some(item => item.equipmentAlert && item.message.includes('photographed a broken motion detector')))
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
  assert.equal(state.hunters[0].ap, 2)
  assert.equal(state.hunters[1].ap, 3)
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

test('two researchers start with a support grant; both team sizes start with no gear, and pay upkeep until the treasury is empty', () => {
  for (const team of [seats, [...seats, { id: 'd', name: 'Morgan', role: 'hunter' }]]) {
    const state = createMatch(team, 'Mothman', () => 0)
    assert.equal(state.cash, team.length === 3 ? 2600 : 2000)
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
  assert.deepEqual(Object.keys(launched.body.classDetails), ['ranger', 'biker', 'prepper', 'trapper', 'biologist', 'rescue'])
  assert.equal(launched.body.players.filter(player => player.role === 'hunter').length, 3)
  assert.equal(launched.body.speciesOptions, undefined)
  assert.equal((await request('POST', base + 'species', { species: 'Sasquatch' }, first.token)).status, 403)
  assert.equal((await request('POST', base + 'preference', { preference: 'hunter' }, choose.token)).status, 409)
  const selection = (await request('GET', base + 'state', null, choose.token)).body
  assert.deepEqual(selection.speciesOptions, ['Sasquatch', 'Mothman', 'Jersey Devil', 'Chupacabra', 'Mimic'])
  assert.equal((await request('POST', base + 'class', { hunterClass: 'ranger' }, choose.token)).status, 403)
  assert.equal((await request('POST', base + 'species', { species: 'Unknown' }, choose.token)).status, 400)
  const picked = await request('POST', base + 'species', { species: 'Sasquatch' }, choose.token)
  assert.equal(picked.body.chosenSpecies, 'Sasquatch')
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
  assert.equal(ready.body.match.player.className, 'Expedition Quartermaster')
  assert.equal(ready.body.match.cash, 2200)
  const hunter = (await request('GET', base + 'state', null, first.token)).body.match
  assert.equal(Object.hasOwn(hunter, 'species'), false)
  assert.equal(hunter.cryptid, null)
  assert.ok(hunter.hunters.some(player => player.className === 'Live-Capture Technician'))
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
  for (const [index, hunterClass] of ['ranger', 'biologist', 'biker'].entries()) {
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

test('night budgets vary by species and movement is independent of AP', () => {
  for (const [species, ap, movement] of [['Sasquatch', 9, 3], ['Mimic', 8, 3], ['Mothman', 6, 3], ['Jersey Devil', 7, 3], ['Chupacabra', 8, 4]]) {
    const state = game(species)
    state.cryptid.pos = 'D6'
    doAction(state, 'a', 'end')
    doAction(state, 'b', 'end')
    assert.equal(matchView(state, 'c').player.ap, ap)
    assert.equal(matchView(state, 'c').player.movement, movement)
    doAction(state, 'c', 'move', 'D7')
    assert.equal(state.cryptid.ap, ap)
    assert.equal(state.cryptid.movement, movement - 1)
    state.cryptid.ap = 2
    doAction(state, 'c', 'forage')
    assert.equal(state.cryptid.ap, 0)
    assert.equal(state.cryptid.movement, movement - 1)
    assert.ok(matchView(state, 'c').moves.includes('D6'))
    doAction(state, 'c', 'move', 'D6')
    state.cryptid.movement = 0
    assert.deepEqual(matchView(state, 'c').moves, [])
    assert.throws(() => doAction(state, 'c', 'move', 'D5'), /no movement left/)
    doAction(state, 'c', 'end')
    assert.equal(state.phase, 'hunters')
    assert.equal(state.cryptid.movement, 0)
  }
})

test('a 1v1 commander selects, switches, and separately acts with three researchers', async () => {
  for (const local of [false, true]) {
    const request = roomClient()
    const created = (await request('POST', '/api/rooms', { local, playerCount: 2, name: 'Commander' })).body
    const base = '/api/rooms/' + created.view.code + '/'
    const commander = created.token
    const cryptid = local ? created.localSeats[1].token : (await request('POST', base + 'seats', { name: 'Cryptid' })).body.token
    await request('POST', base + 'preference', { preference: 'cryptid' }, cryptid)
    const started = await request('POST', base + 'start', {}, commander)
    assert.equal(started.status, 200)
    assert.deepEqual(started.body.player.hunterClasses, [])
    await request('POST', base + 'species', { species: 'Sasquatch' }, cryptid)
    for (const hunterClass of ['ranger', 'ranger', 'trapper']) {
      assert.equal((await request('POST', base + 'class', { hunterClass }, commander)).body.stage, 'loadout')
    }
    const ready = (await request('GET', base + 'state', null, cryptid)).body
    assert.equal(ready.players.find(player => player.role === 'hunter').classReady, false)
    assert.ok(ready.players.every(player => !Object.hasOwn(player, 'hunterClasses')))
    const { match } = (await request('POST', base + 'class', { hunterClass: 'biker' }, commander)).body
    const [ranger, trapper, biker] = match.controlledHunterIds
    assert.equal(new Set(match.controlledHunterIds).size, 3)
    assert.equal(match.supportGrant, 0)
    assert.equal(match.species, undefined)
    const state = async (id, token = commander) => (await request('GET', base + 'state?hunterId=' + id, null, token)).body.match
    const action = (type, hunterId, token = commander, target) => request('POST', base + 'actions', {
      type, hunterId, target, round: 1,
    }, token)
    assert.equal((await state(trapper)).player.hunterClass, 'trapper')
    assert.equal((await state(trapper, cryptid)).role, 'cryptid')
    assert.equal((await action('move', trapper, cryptid, 'D6')).status, 409)
    const moved = await action('move', trapper, commander, 'D6')
    assert.equal(moved.body.match.player.pos, 'D6')
    assert.equal(moved.body.match.player.ap, 3)
    assert.equal(moved.body.match.player.movement, 1)
    assert.equal((await state(ranger)).player.pos, CAMP)
    assert.equal((await state(biker)).player.ap, 3)
    assert.equal((await action('search', ranger)).status, 200)
    assert.equal((await state(biker)).player.searchedHere, false)
    assert.ok((await state(biker)).actions.some(item => item.type === 'search'))
    assert.equal((await action('search', biker)).status, 200)
    assert.equal((await action('search', biker)).status, 409)
    assert.equal((await state(biker)).player.ap, 2)
    assert.equal((await action('search', trapper)).status, 200)
    for (const id of [ranger, trapper]) assert.equal((await action('end', id)).body.match.phase, 'hunters')
    assert.equal((await action('end', biker)).body.match.phase, 'cryptid')
  }
})

test('Host and Join support fixed-size 1v1, 2v1, and 3v1 matches', async () => {
  const request = roomClient()
  for (const playerCount of [2, 3, 4]) {
    const host = (await request('POST', '/api/rooms', { name: 'Host', playerCount: String(playerCount) })).body
    assert.equal(host.localSeats, undefined)
    assert.equal(host.view.minPlayers, playerCount)
    assert.equal(host.view.maxPlayers, playerCount)
    const base = '/api/rooms/' + host.view.code + '/'
    const hunters = []
    for (let seat = 1; seat < playerCount; seat++) {
      assert.equal((await request('POST', base + 'start', {}, host.token)).status, 409)
      const joined = await request('POST', base + 'seats', { name: 'Hunter ' + seat })
      assert.equal(joined.status, 201)
      assert.equal(joined.body.view.maxPlayers, playerCount)
      hunters.push(joined.body.token)
    }
    assert.equal((await request('POST', base + 'seats', { name: 'Extra' })).status, 409)
    await request('POST', base + 'preference', { preference: 'cryptid' }, host.token)
    assert.equal((await request('POST', base + 'start', {}, host.token)).body.stage, 'loadout')
    await request('POST', base + 'species', { species: 'Sasquatch' }, host.token)

    const classes = ['ranger', 'biker', 'trapper']
    if (playerCount === 2) {
      for (const hunterClass of classes) await request('POST', base + 'class', { hunterClass }, hunters[0])
    } else {
      for (const [index, token] of hunters.entries()) {
        await request('POST', base + 'class', { hunterClass: classes[index] }, token)
      }
    }
    const match = (await request('GET', base + 'state', null, hunters[0])).body.match
    assert.equal(match.hunters.length, playerCount === 3 ? 2 : 3)
    assert.equal(match.controlledHunterIds.length, playerCount === 2 ? 3 : 1)
    assert.equal(match.supportGrant, playerCount === 3 ? 600 : 0)
  }
})

test('a 2v1 lobby gives each researcher one unit and the team a support grant', async () => {
  const request = roomClient()
  const host = (await request('POST', '/api/rooms', { name: 'Ranger' })).body
  const base = '/api/rooms/' + host.view.code + '/'
  const teammate = (await request('POST', base + 'seats', { name: 'Trapper' })).body
  const cryptid = (await request('POST', base + 'seats', { name: 'Cryptid' })).body
  await request('POST', base + 'preference', { preference: 'cryptid' }, cryptid.token)
  await request('POST', base + 'start', {}, host.token)
  await request('POST', base + 'species', { species: 'Mothman' }, cryptid.token)
  await request('POST', base + 'class', { hunterClass: 'ranger' }, host.token)
  const { match } = (await request('POST', base + 'class', { hunterClass: 'trapper' }, teammate.token)).body
  assert.equal(match.hunters.length, 2)
  assert.equal(match.controlledHunterIds.length, 1)
  assert.equal(match.supportGrant, 600)
  assert.equal(match.cash, 2600)
  const other = match.hunters.find(hunter => hunter.id !== match.player.id)
  const blocked = await request('POST', base + 'actions', { type: 'end', hunterId: other.id, round: 1 }, teammate.token)
  assert.equal(blocked.status, 409)
})

test('two researcher moves leave all AP available, and spending AP still permits movement', () => {
  const state = game()
  for (const target of ['D6', 'D5']) doAction(state, 'a', 'move', target)
  const spentMovement = matchView(state, 'a')
  assert.equal(spentMovement.player.ap, 3)
  assert.equal(spentMovement.player.movement, 0)
  assert.deepEqual(spentMovement.moves, [])
  assert.throws(() => doAction(state, 'a', 'move', 'D6'), /no movement left/)
  equip(state.hunters[1], 'detector')
  for (let i = 0; i < 3; i++) doAction(state, 'b', 'deploy', 'detector')
  assert.equal(matchView(state, 'b').player.ap, 0)
  assert.ok(matchView(state, 'b').moves.includes('D6'))
  doAction(state, 'b', 'move', 'D6')
  assert.equal(matchView(state, 'b').player.movement, 1)
  for (const actor of ['a', 'b', 'c']) doAction(state, actor, 'end')
  assert.equal(matchView(state, 'a').player.movement, 2)
  assert.equal(matchView(state, 'b').player.ap, 3)
})

test('sneaking spends AP and movement, leaves no tracks, and still triggers cameras', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  state.devices.push(device('camera', 'D5'))
  cryptidPhase(state)
  assert.ok(matchView(state, 'c').actions.some(item => item.type === 'sneak' && item.target === 'D5'))
  doAction(state, 'c', 'sneak', 'D5')
  assert.equal(state.cryptid.ap, 0)
  assert.equal(state.cryptid.movement, 1)
  assert.equal(matchView(state, 'a').cryptid, null)
  assert.equal(state.devices[0].recordings.length, 1)
  assert.ok(!state.clues.some(clue => clue.type === 'tracks'))
  assert.throws(() => doAction(state, 'c', 'sneak', 'D6'), /requires 2 AP/)
  state.cryptid.ap = 2
  assert.ok(!matchView(state, 'c').actions.some(item => item.type === 'sneak'))
  assert.throws(() => doAction(state, 'c', 'sneak', 'D6'), /requires 2 movement/)
})

test('foraging reduces hunger once per Night and flushing wildlife can trigger detection', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  state.cryptid.hunger = 2
  const animal = state.animals[0]
  animal.pos = 'D6'
  const detector = device('detector', 'D5')
  state.devices.push(detector)
  cryptidPhase(state)
  state.cryptid.ap = 6
  doAction(state, 'c', 'forage')
  assert.equal(state.cryptid.hunger, 1)
  assert.throws(() => doAction(state, 'c', 'forage'), /once per night/)
  doAction(state, 'c', 'flush', 'D5')
  assert.equal(animal.pos, 'D5')
  assert.ok(detector.occupants.includes(animal.id))
  assert.equal(state.cryptid.pos, 'D6')
  assert.equal(state.cryptid.ap, 2)
  assert.equal(state.cryptid.movement, 3)
})

test('factions expose six exclusive roles and enforce their purchases in the lobby and match', async () => {
  for (const [faction, classes, gearType, forbidden, price] of [
    ['researchers', ['ranger', 'biologist', 'rescue'], 'anchor', 'rifle', 125],
    ['hunters', ['armorer', 'marksman', 'tracker'], 'rifle', 'lowLight', 131],
    ['fans', ['producer', 'naturalist', 'videographer'], 'lowLight', 'netgun', 105],
  ]) {
    const request = roomClient()
    const host = (await request('POST', '/api/rooms', { local: true, playerCount: 2 })).body
    const base = '/api/rooms/' + host.view.code + '/'
    const cryptid = host.localSeats[1].token
    assert.equal((await request('POST', base + 'faction', { faction }, cryptid)).status, 403)
    assert.equal((await request('POST', base + 'faction', { faction }, host.token)).body.faction, faction)
    await request('POST', base + 'preference', { preference: 'cryptid' }, cryptid)
    const { body: lobby } = await request('POST', base + 'start', {}, host.token)
    assert.equal(Object.keys(lobby.classDetails).length, 6)
    assert.equal((await request('POST', base + 'faction', { faction: 'fans' }, host.token)).status, 409)
    const wrongRole = faction === 'researchers' ? 'marksman' : 'ranger'
    assert.equal((await request('POST', base + 'class', { hunterClass: wrongRole }, host.token)).status, 400)
    await request('POST', base + 'species', { species: 'Sasquatch' }, cryptid)
    for (const hunterClass of classes) await request('POST', base + 'class', { hunterClass }, host.token)
    const { body: { match } } = await request('GET', base + 'state', null, host.token)
    assert.equal(match.shop[gearType], price)
    assert.equal(match.shop[forbidden], undefined)
    assert.equal(match.shop.detector, 45)
    const buy = target => request('POST', base + 'actions', { type: 'buy', target, site: CAMP, round: 1 }, host.token)
    assert.equal((await buy(forbidden)).status, 409)
    assert.equal((await buy(gearType)).body.match.cash, match.cash - price)
  }
})

test('the Blood Tracker sees the real direction after a false trail and a sneak', () => {
  const state = createMatch(seats.map(seat => ({ ...seat, hunterClass: seat.id === 'a' ? 'tracker' : undefined })),
    'Sasquatch', () => 0, 'hunters')
  state.cryptid.pos = CAMP
  state.cryptid.wounded = true
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  doAction(state, 'c', 'mislead', 'E')
  doAction(state, 'c', 'sneak', 'D6')
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'search')
  const clues = matchView(state, 'a').clues
  assert.deepEqual(clues.map(clue => clue.name), ['Blood trail heading north', 'False Sasquatch tracks east'])
  assert.equal(clues[0].date, 'Fresh')
  assert.equal(matchView(state, 'a').player.digital.find(item => item.type === 'blood').trackAge, 'Fresh')
})

test('Mothman flight breaks the blood trail between ground movements', () => {
  const state = game('Mothman')
  state.cryptid.pos = CAMP
  state.cryptid.wounded = true
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  doAction(state, 'c', 'move', 'D6')
  doAction(state, 'c', 'ability', 'N')
  doAction(state, 'c', 'move', 'D3')
  assert.deepEqual(state.clues.filter(clue => clue.type === 'blood').map(clue => clue.pos), [CAMP, 'D4'])
})

test('footprint photographs record age at capture and exclude tracks four rounds old', () => {
  const state = game()
  state.round = 5
  for (const round of [1, 2, 3, 4, 5]) state.clues.push(evidence('tracks', CAMP, round))
  const findings = doAction(state, 'a', 'search')
  const view = matchView(state, 'a')
  assert.deepEqual(view.player.digital.map(item => item.trackAge), ['Cold', '2 rounds ago', 'Fresh', 'Fresh'])
  assert.deepEqual(searchView(view, findings).cards.map(card => card.label),
    ['Cryptid tracks · Fresh', 'Cryptid tracks · Fresh', 'Cryptid tracks · 2 rounds ago', 'Cryptid tracks · Cold'])
  state.round++
  assert.equal(matchView(state, 'a').player.digital.at(-1).trackAge, 'Fresh')
})

test('direct footprint and Cryptid photographs cost the same as Search even for the Trail Vlogger', () => {
  const state = createMatch(seats.map(seat => ({ ...seat, hunterClass: seat.id === 'a' ? 'cyclist' : undefined })),
    'Sasquatch', () => 0, 'fans')
  state.cryptid.pos = CAMP
  const discovery = { round: 1, exact: false }
  const sighting = evidence('sighting', CAMP, 1, { discovery })
  state.cryptid.seen = sighting
  state.clues.push(evidence('tracks', CAMP, 1, { discovery }), sighting)
  const photos = matchView(state, 'a').actions.filter(action => action.type === 'photo')
  assert.equal(photos.length, 2)
  assert.ok(photos.every(action => action.label.endsWith(' · 1 AP')))
  for (const photo of photos) doAction(state, 'a', 'photo', photo.target)
  assert.equal(state.hunters[0].ap, 1)
  assert.throws(() => doAction(state, 'b', 'photo', sighting.id), /already been photographed/)
  const findings = doAction(state, 'b', 'search')
  assert.equal(findings.clueIds.length, 2)
  assert.deepEqual(matchView(state, 'b').player.digital, [])
})

test('selling a Cryptid photo names the species in the team log', () => {
  const state = game('Jersey Devil')
  state.cryptid.pos = CAMP
  state.clues.push(evidence('tracks', CAMP, 1, { dir: 'W' }))
  doAction(state, 'a', 'search')
  assert.equal(matchView(state, 'b').clues.find(clue => clue.type === 'tracks').name, 'Cryptid tracks west')
  assert.ok(matchView(state, 'a').player.digital.some(item => item.type === 'sighting' && item.photo))
  assert.ok(!matchView(state, 'b').logs.some(item => item.message.includes('identified the species')))
  doAction(state, 'a', 'submit', undefined, { site: CAMP })
  assert.ok(matchView(state, 'b').logs.some(item => item.message.includes('identified the species as Jersey Devil')))
  assert.equal(matchView(state, 'b').clues.find(clue => clue.type === 'tracks').name, 'Jersey Devil tracks west')
  assert.equal(matchView(state, 'a').player.digital.length, 0)
})

test('a Hunters team must confirm the Cryptid and land two shots, with one shot per unit per Day', () => {
  const state = createMatch(seats, 'Sasquatch', () => 0, 'hunters')
  state.cryptid.pos = CAMP
  for (const hunter of state.hunters) equip(hunter, 'rifle')
  assert.throws(() => doAction(state, 'a', 'fireRifle'), /confirmed Cryptid/)
  doAction(state, 'a', 'search')
  doAction(state, 'a', 'fireRifle')
  assert.equal(state.cryptid.wounded, true)
  assert.equal(state.winner, null)
  assert.equal(state.hunters[0].ap, 0)
  state.hunters[0].ap = 2
  assert.throws(() => doAction(state, 'a', 'fireRifle'), /already fired today/)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'move', 'D6')
  assert.equal(state.clues.find(clue => clue.type === 'blood').dir, 'N')
  doAction(state, 'c', 'end')
  doAction(state, 'b', 'move', 'D6')
  state.cryptid.restraint = { device: null }
  assert.ok(matchView(state, 'b').actions.some(action => action.type === 'fireRifle'))
  doAction(state, 'b', 'fireRifle')
  assert.equal(state.winner, 'hunters')
  assert.equal(matchView(state, 'b').faction.outcome, 'Cryptid killed')
})

test('Fans need clear footage and a separate verified event; duplicated recordings count once', () => {
  const state = createMatch(seats, 'Sasquatch', () => 0, 'fans')
  state.cryptid.pos = 'D5'
  for (const type of ['lowLight', 'lowLight', 'mic']) state.devices.push(device(type, 'D6'))
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D6')
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  assert.equal(state.hunters[0].digital.filter(item => item.type === 'clearVideo').length, 2)
  doAction(state, 'a', 'move', CAMP)
  doAction(state, 'a', 'submit', undefined, { site: CAMP })
  assert.deepEqual(matchView(state, 'a').proof, { count: 1, visual: true })
  assert.equal(state.winner, null)
  doAction(state, 'a', 'end')
  doAction(state, 'b', 'end')
  doAction(state, 'c', 'mislead', 'S')
  doAction(state, 'c', 'end')
  doAction(state, 'b', 'move', 'D6')
  doAction(state, 'b', 'move', CAMP)
  doAction(state, 'b', 'submit', undefined, { site: CAMP })
  assert.deepEqual(matchView(state, 'b').proof, { count: 2, visual: true })
  assert.equal(state.winner, 'hunters')
})

test('Fans can preserve discovered Cryptid feeding remains as verifiable proof', () => {
  const state = createMatch(seats, 'Sasquatch', () => 0, 'fans')
  const clue = evidence('feed', CAMP, 1)
  state.clues.push(clue)
  equip(state.hunters[0], 'sampleKit')
  doAction(state, 'a', 'search')
  assert.ok(matchView(state, 'a').actions.some(item => item.type === 'preserve' && item.target === clue.id))
  doAction(state, 'a', 'preserve', clue.id)
  assert.equal(state.hunters[0].cargo[0].type, 'verifiedSample')
  doAction(state, 'a', 'submit', undefined, { site: CAMP })
  assert.deepEqual(matchView(state, 'a').proof, { count: 1, visual: false })
  assert.equal(state.winner, null)
})

test('Sasquatch needs five sabotages across three sectors to unlock its private ultimate', () => {
  const state = game()
  state.cryptid.pos = CAMP
  for (const [type, pos] of [['detector', 'D6'], ['camera', 'D6'], ['tent', 'D6'], ['camera', 'D5'], ['tent', 'C5']]) {
    state.devices.push(device(type, pos))
  }
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  for (const pos of ['D6', 'D5', 'C5']) {
    doAction(state, 'c', 'move', pos)
    for (const item of state.devices.filter(item => item.pos === pos)) doAction(state, 'c', 'destroy', item.id)
    if (pos !== 'C5') assert.equal(state.winner, null)
  }
  assert.equal(matchView(state, 'c').goal.progress, 5)
  assert.equal(matchView(state, 'a').goal, undefined)
  assert.equal(state.winner, null)
  assert.equal(matchView(state, 'c').ultimate.unlocked, true)
  assert.ok(state.cash > 0)
})

test('Mothman unlocks its ultimate by visiting four named flight landings across Nights', () => {
  const state = game('Mothman')
  state.cryptid.pos = 'D3'
  for (const [walk, flight] of [[[], 'N'], [['D2'], 'S'], [['D5'], 'S'], [['D6', 'D5'], 'W']]) {
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    for (const target of walk) doAction(state, 'c', 'move', target)
    doAction(state, 'c', 'ability', flight)
    assert.equal(state.cryptid.ap, 2)
    assert.ok(!matchView(state, 'c').actions.some(action => action.type === 'ability'))
    doAction(state, 'c', 'end')
  }
  assert.equal(matchView(state, 'c').goal.progress, 4)
  assert.equal(state.winner, null)
  assert.equal(matchView(state, 'c').ultimate.unlocked, true)
})

test('the Jersey Devil needs six scares across three Nights and reduces next-Day AP', () => {
  const state = game('Jersey Devil')
  state.cryptid.pos = 'D6'
  for (let night = 1; night <= 3; night++) {
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    doAction(state, 'c', 'ability')
    assert.equal(state.cryptid.ap, 2)
    assert.equal(matchView(state, 'c').goal.progress, night * 2)
    if (night === 3) break
    assert.equal(state.winner, null)
    state.cryptid.ap = 5
    assert.throws(() => doAction(state, 'c', 'ability'), /nobody close enough/)
    doAction(state, 'c', 'end')
    assert.deepEqual(state.hunters.map(hunter => hunter.ap), [2, 2])
  }
  assert.equal(state.winner, null)
  assert.equal(matchView(state, 'c').ultimate.unlocked, true)
})

test('the Chupacabra lures wildlife and needs five meals across three Nights and three species', () => {
  const state = game('Chupacabra')
  state.cryptid.pos = 'D6'
  const rabbits = state.animals.filter(animal => animal.species === 'rabbit')
  const turkey = state.animals.find(animal => animal.species === 'turkey')
  const deer = state.animals.find(animal => animal.species === 'deer')
  const meals = [[rabbits[0], rabbits[1]], [turkey, deer], [rabbits[2]]]
  for (const animals of meals) {
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    for (const animal of animals) {
      if (animal === deer) {
        animal.pos = 'D5'
        assert.ok(matchView(state, 'c').actions.some(action => action.type === 'ability' && action.target === deer.id))
        doAction(state, 'c', 'ability', deer.id)
      } else animal.pos = 'D6'
      doAction(state, 'c', 'feed', animal.id)
    }
    if (!state.winner) doAction(state, 'c', 'end')
  }
  assert.equal(matchView(state, 'c').goal.progress, 5)
  assert.equal(state.winner, null)
  assert.equal(matchView(state, 'c').ultimate.unlocked, true)
})

test('the new capture traps trigger only on their matching species and special action', () => {
  for (const [species, trapType, type] of [['Jersey Devil', 'resonance', 'ability'], ['Chupacabra', 'baitCage', 'feed'], ['Mimic', 'voiceTrap', 'ability']]) {
    const state = game(species)
    state.cryptid.pos = 'D5'
    const trap = device(trapType, 'D6')
    state.devices.push(trap)
    if (species === 'Mimic') state.devices.push(device('detector', 'D3'))
    cryptidPhase(state)
    state.cryptid.ap = 5
    doAction(state, 'c', 'move', 'D6')
    assert.equal(state.cryptid.restraint, null)
    const animal = state.animals[0]
    animal.pos = 'D6'
    doAction(state, 'c', type, type === 'feed' ? animal.id : species === 'Mimic' ? 'D5' : undefined)
    assert.equal(state.cryptid.restraint.device, trap.id)
    assert.equal(matchView(state, 'c').goal.progress, 0)
    doAction(state, 'c', 'end')
    doAction(state, 'a', 'move', 'D6')
    doAction(state, 'a', 'search')
    doAction(state, 'a', 'capture')
    assert.equal(state.winner, 'hunters')
  }
})

test('the Mimic unlocks Animal Form after four investigated spoofed alerts and at least two investigators', () => {
  const state = game('Mimic')
  state.cryptid.pos = 'D3'
  state.devices.push(device('detector', 'D6'))
  for (let night = 1; night <= 5; night++) {
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    doAction(state, 'c', 'ability')
    assert.equal(state.cryptid.ap, 3)
    doAction(state, 'c', 'end')
    assert.equal(matchView(state, 'a').goal, undefined)
    const investigator = night === 5 ? 'b' : 'a'
    doAction(state, investigator, 'move', 'D6')
    assert.equal(matchView(state, 'c').goal.progress, night - 1)
    doAction(state, investigator, 'search')
    assert.equal(matchView(state, 'c').goal.progress, night)
    if (night < 5) {
      assert.equal(matchView(state, 'c').ultimate.unlocked, false)
      doAction(state, investigator, 'move', CAMP)
    }
  }
  assert.equal(state.winner, null)
  assert.equal(matchView(state, 'c').ultimate.unlocked, true)
})


test('only Researchers can buy tags and tag snared animals; only Hunters can hunt', () => {
  for (const faction of ['researchers', 'hunters', 'fans']) {
    const state = createMatch(seats, 'Sasquatch', () => 0, faction)
    const [hunter] = state.hunters
    const [rabbit, free] = state.animals
    rabbit.pos = free.pos = CAMP
    equip(hunter, 'tag', 'snare')
    doAction(state, 'a', 'deploy', 'snare')
    doAction(state, 'a', 'search')
    assert.ok(rabbit.snare)
    assert.ok(!free.snare)
    assert.equal(Object.hasOwn(matchView(state, 'a').shop, 'tag'), faction === 'researchers')
    if (faction === 'researchers') {
      assert.throws(() => doAction(state, 'a', 'tag', free.id), /live snared/)
      assert.throws(() => doAction(state, 'a', 'hunt', rabbit.id), /Only Hunters/)
      doAction(state, 'a', 'tag', rabbit.id)
      assert.equal(rabbit.tagged, true)
    } else {
      assert.throws(() => doAction(state, 'a', 'buy', 'tag'), /not available/)
      assert.throws(() => doAction(state, 'a', 'tag', rabbit.id), /Only Researchers/)
      if (faction === 'fans') assert.throws(() => doAction(state, 'a', 'hunt', rabbit.id), /Only Hunters/)
    }
  }
})

test('Hunters use a rifle round on free wildlife and can harvest snared wildlife without a round', () => {
  const state = createMatch(seats, 'Sasquatch', () => 0, 'hunters')
  const [hunter] = state.hunters
  const [trapped, free] = state.animals
  trapped.pos = free.pos = CAMP
  equip(hunter, 'snare')
  doAction(state, 'a', 'deploy', 'snare')
  doAction(state, 'a', 'search')
  assert.throws(() => doAction(state, 'a', 'hunt', free.id), /loaded rifle/)
  equip(hunter, 'rifle')
  const rifle = hunter.gear.find(pack => pack.type === 'rifle')
  doAction(state, 'a', 'hunt', free.id)
  assert.equal(rifle.qty, 1)
  for (const actor of ['a', 'b', 'c']) doAction(state, actor, 'end')
  doAction(state, 'a', 'hunt', trapped.id)
  assert.equal(rifle.qty, 1)
})

test('cryptid snares ignore wildlife even if it is already in the sector', () => {
  const state = game()
  state.cryptid.pos = 'D6'
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  const animal = state.animals[0]
  animal.pos = 'D6'
  doAction(state, 'c', 'setSnare')
  assert.equal(animal.snare, undefined)
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  assert.ok(state.hunters[0].restraint)
})

test('each unlocked ultimate spends a full AP budget and can be reused after two rounds', () => {
  for (const species of ['Sasquatch', 'Mothman', 'Jersey Devil', 'Chupacabra', 'Mimic']) {
    const state = game(species)
    state.cryptid.pos = 'D6'
    state.devices.push(device('detector', species === 'Mimic' ? 'D3' : 'D5'))
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    const before = matchView(state, 'c')
    const target = species === 'Mothman' ? 'N' : species === 'Mimic' ? 'deer' : undefined
    assert.throws(() => doAction(state, 'c', 'ultimate', target), /locked/)
    state.cryptid.ultimateUnlocked = true
    state.cryptid.ap--
    assert.ok(!matchView(state, 'c').actions.some(item => item.type === 'ultimate'))
    assert.throws(() => doAction(state, 'c', 'ultimate', target), /enough AP/)
    state.cryptid.ap++
    assert.ok(matchView(state, 'c').actions.some(item => item.type === 'ultimate'))
    doAction(state, 'c', 'ultimate', target)
    assert.equal(before.ultimate.cost, before.player.maxAP)
    assert.equal(state.cryptid.ap, 0)
    assert.equal(matchView(state, 'c').ultimate.cooldown, 2)
    assert.equal(matchView(state, 'a').ultimate, undefined)
    assert.equal(state.winner, null)
    state.cryptid.ap = 9
    assert.throws(() => doAction(state, 'c', 'ultimate', target), /on cooldown/)
    if (species === 'Sasquatch') assert.equal(state.devices.length, 0)
    if (species === 'Mothman') assert.equal(state.cryptid.pos, 'D2')
    if (species === 'Chupacabra') {
      assert.equal(state.cryptid.hunger, 0)
      assert.equal(state.cryptid.movement, 7)
    }
    doAction(state, 'c', 'end')
    if (species === 'Jersey Devil') assert.equal(matchView(state, 'a').player.ap, 1)
    if (species === 'Mimic') assert.equal(matchView(state, 'c').player.disguise, 'Deer')
    for (const remaining of [2, 1, 0]) {
      for (const actor of ['a', 'b']) doAction(state, actor, 'end')
      assert.equal(matchView(state, 'c').ultimate.cooldown, remaining)
      if (!remaining) break
      assert.ok(!matchView(state, 'c').actions.some(item => item.type === 'ultimate'))
      assert.throws(() => doAction(state, 'c', 'ultimate', target), /on cooldown/)
      doAction(state, 'c', 'end')
    }
    doAction(state, 'c', 'ultimate', species === 'Mothman' ? 'S' : target)
    assert.equal(state.cryptid.ap, 0)
  }
})

test('a mounted biker must dismount before any field or site action', () => {
  const state = game('Sasquatch', { a: 'biker' })
  const hunter = state.hunters[0]
  equip(hunter, 'camera')
  doAction(state, 'a', 'toggleBike')
  assert.deepEqual(matchView(state, 'a').actions.map(item => item.type), ['toggleBike'])
  assert.throws(() => doAction(state, 'a', 'search'), /Dismount/)
  assert.throws(() => doAction(state, 'a', 'deploy', 'camera'), /Dismount/)
  assert.throws(() => doAction(state, 'a', 'buy', 'tag'), /Dismount/)
  state.cryptidSnares.push({ id: randomUUID(), pos: 'D6', discovered: false })
  doAction(state, 'a', 'move', 'D6')
  assert.equal(hunter.restraint, null)
  doAction(state, 'a', 'toggleBike')
  assert.ok(hunter.restraint)
  assert.equal(matchView(state, 'a').player.movement, 0)
  assert.equal(hunter.ap, 1)
  assert.throws(() => doAction(state, 'a', 'escape'), /requires 2 AP/)
  for (const actor of ['a', 'b', 'c']) doAction(state, actor, 'end')
  doAction(state, 'a', 'escape')
  assert.equal(hunter.ap, 1)
})

test('cryptids spend two AP to escape restraint', () => {
  const state = game()
  cryptidPhase(state)
  state.cryptid.restraint = { device: null }
  state.cryptid.ap = 1
  assert.ok(!matchView(state, 'c').actions.some(item => item.type === 'escape'))
  assert.throws(() => doAction(state, 'c', 'escape'), /not have enough AP/)
  state.cryptid.ap = 2
  doAction(state, 'c', 'escape')
  assert.equal(state.cryptid.ap, 0)
  assert.equal(state.cryptid.restraint, null)
})

test('Phantom Trigger selects only remote equipment and spoofs its alert without activating the device', () => {
  const state = game('Mimic')
  state.cryptid.pos = 'D6'
  const near = device('detector', 'E5')
  const first = device('detector', 'D4')
  const second = device('camera', 'B6')
  const blockade = { ...device('blockade', 'D4'), to: 'D3' }
  state.devices.push(near, blockade)
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  assert.ok(!matchView(state, 'c').actions.some(item => item.type === 'ability'))
  assert.throws(() => doAction(state, 'c', 'ability'), /more than one sector away/)
  assert.equal(state.cryptid.ap, 8)
  state.devices.push(first, second)
  state.random = () => .99
  doAction(state, 'c', 'ability')
  assert.equal(state.cryptid.ap, 3)
  const shown = matchView(state, 'a').devices.filter(item => item.activated != null)
  assert.deepEqual(shown.map(item => item.id), [second.id])
  assert.equal(second.activated, null)
  assert.deepEqual(second.recordings, [])
  assert.equal(matchView(state, 'a').cryptid, null)
  doAction(state, 'c', 'end')
  assert.equal(matchView(state, 'a').devices.find(item => item.id === second.id).activated, 1)
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  assert.equal(matchView(state, 'a').devices.find(item => item.id === second.id).activated, null)
})

test('Mimic animal form leaves animal tracks, can be snared and tagged, and expires after two Days', () => {
  const state = game('Mimic')
  state.cryptid.pos = 'D5'
  state.animals = []
  const observer = state.hunters[0]
  observer.pos = 'D6'
  equip(observer, 'snare', 'tag')
  doAction(state, 'a', 'deploy', 'snare')
  doAction(state, 'a', 'move', CAMP)
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  state.cryptid.ultimateUnlocked = true
  doAction(state, 'c', 'ultimate', 'rabbit')
  doAction(state, 'c', 'move', 'D6')
  const disguise = state.cryptid.disguise
  assert.ok(disguise.snare)
  assert.equal(state.cryptid.movement, 0)
  assert.ok(state.clues.some(clue => clue.type === 'animalTracks' && clue.animalSpecies === 'rabbit' && clue.pos === 'D5'))
  assert.ok(!state.clues.some(clue => clue.type === 'tracks'))
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  assert.equal(matchView(state, 'a').cryptid, null)
  doAction(state, 'a', 'search')
  assert.ok(matchView(state, 'a').actions.some(item => item.type === 'tag' && item.target === disguise.id))
  doAction(state, 'a', 'tag', disguise.id)
  assert.ok(matchView(state, 'a').animals.some(item => item.id === disguise.id && item.tagged))
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  assert.equal(state.cryptid.disguise, disguise)
  doAction(state, 'c', 'end')
  assert.equal(state.cryptid.disguise, disguise)
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  assert.equal(state.cryptid.disguise, undefined)
  assert.equal(matchView(state, 'a').cryptid.name, 'Mimic')
  assert.equal(matchView(state, 'a').cryptid.tagged, true)
})

test('a shot at the disguised Mimic consumes a round, reveals it, and ends only the shooter’s turn', () => {
  const state = createMatch(seats, 'Mimic', () => 0, 'hunters')
  state.cryptid.pos = 'D6'
  state.animals = []
  equip(state.hunters[0], 'rifle')
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  state.cryptid.ultimateUnlocked = true
  doAction(state, 'c', 'ultimate', 'deer')
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'search')
  assert.equal(matchView(state, 'a').cryptid, null)
  const target = state.cryptid.disguise.id
  doAction(state, 'a', 'hunt', target)
  assert.equal(state.hunters[0].gear[0].qty, 1)
  assert.equal(state.hunters[0].ended, true)
  assert.equal(state.hunters[1].ended, false)
  assert.equal(state.phase, 'hunters')
  assert.equal(matchView(state, 'b').cryptid.name, 'Mimic')
  assert.equal(state.cryptid.wounded, false)
})

test('wildlife leaves species tracks and only eligible cryptids can mislead', () => {
  for (const species of ['rabbit', 'turkey', 'deer']) {
    const state = game()
    const animal = state.animals.find(item => item.species === species)
    animal.pos = 'D6'
    state.animals = [animal]
    for (const actor of ['a', 'b']) doAction(state, actor, 'end')
    assert.ok(state.clues.some(clue => clue.type === 'animalTracks' && clue.animalSpecies === species && clue.pos === 'D6'))
  }
  for (const species of ['Mothman', 'Chupacabra']) {
    const state = game(species)
    state.cryptid.pos = 'D6'
    cryptidPhase(state)
    assert.ok(!matchView(state, 'c').actions.some(action => action.type === 'mislead'))
    assert.throws(() => doAction(state, 'c', 'mislead', 'N'), /cannot leave false tracks/)
  }
  const state = createMatch(seats.map(unit => ({ ...unit, hunterClass: unit.id === 'a' ? 'believer' : undefined })), 'Mimic', () => 0, 'fans')
  state.cryptid.pos = 'D6'
  cryptidPhase(state)
  doAction(state, 'c', 'mislead', 'N')
  doAction(state, 'c', 'move', 'D5')
  doAction(state, 'c', 'end')
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'search')
  assert.deepEqual(matchView(state, 'a').clues.filter(item => item.type === 'tracks').map(item => item.name),
    ['Mimic tracks north', 'False Mimic tracks north'])
})

test('foraging succeeds below a 20 percent roll and spends AP on failure too', () => {
  for (const [roll, expectedHunger] of [[.199, 1], [.2, 2], [.99, 2]]) {
    const state = game()
    state.random = () => roll
    state.cryptid.pos = 'D6'
    state.cryptid.hunger = 2
    cryptidPhase(state)
    doAction(state, 'c', 'forage')
    assert.equal(state.cryptid.hunger, expectedHunger)
    assert.equal(state.cryptid.ap, 0)
    state.cryptid.ap = 2
    assert.throws(() => doAction(state, 'c', 'forage'), /once per night/)
  }
})

test('every gear and evidence definition has a non-empty player-facing description', () => {
  for (const [key, item] of Object.entries({ ...GEAR, ...EVIDENCE })) {
    assert.ok(item.description?.trim(), key + ' is missing a description')
  }
})

test('Search clears snare alerts without freeing wildlife and the next wildlife turn reactivates them', () => {
  const state = game()
  const rabbit = state.animals[0]
  state.animals = [rabbit]
  rabbit.pos = 'D6'
  const hunter = state.hunters[0]
  equip(hunter, 'snare')
  doAction(state, 'a', 'move', 'D6')
  doAction(state, 'a', 'deploy', 'snare')
  const [trap] = state.devices
  assert.equal(trap.activated, 1)
  doAction(state, 'a', 'search')
  assert.equal(trap.activated, null)
  assert.equal(rabbit.snare, trap.id)
  assert.throws(() => doAction(state, 'a', 'recover', trap.id), /cannot be recovered/)
  for (const actor of ['a', 'b']) doAction(state, actor, 'end')
  assert.equal(trap.activated, 1)
  assert.equal(rabbit.snare, trap.id)
  assert.equal(state.logs.hunters.filter(item => item.message === 'Snare activated at D6.').length, 2)
})

test('a motion alert stays active after its source leaves until somebody searches the sector', () => {
  const state = game()
  state.animals = []
  state.cryptid.pos = 'D6'
  const detector = device('detector', 'D5')
  state.devices.push(detector)
  cryptidPhase(state)
  doAction(state, 'c', 'move', 'D5')
  doAction(state, 'c', 'move', 'E5')
  assert.equal(detector.activated, 1)
  doAction(state, 'c', 'end')
  for (const pos of ['D6', 'D5']) doAction(state, 'a', 'move', pos)
  assert.equal(detector.activated, 1)
  doAction(state, 'a', 'search')
  assert.equal(detector.activated, null)
})

test('search results select artwork from discovered evidence and wildlife', () => {
  const state = game()
  state.animals[0].pos = CAMP
  state.animals[1].pos = CAMP
  state.clues.push(evidence('tracks', CAMP, 1, { dir: 'N' }), evidence('feed', CAMP, 1), evidence('blood', 'D6', 1))
  const found = doAction(state, 'a', 'search')
  assert.deepEqual(searchView(matchView(state, 'a'), found), {
    sector: CAMP, cards: [
      { artwork: 'remains', label: 'Feeding remains' },
      { artwork: 'tracks', label: 'Cryptid tracks north · Fresh' },
      { artwork: 'rabbit', label: 'Rabbit' },
      { artwork: 'rabbit', label: 'Rabbit' },
    ],
  })
  assert.equal(matchView(state, 'b').searchResults, undefined)
  assert.equal(matchView(state, 'c').searchResults, undefined)
})

test('only a successful search response carries discoveries, including when it finds nothing', async () => {
  const request = roomClient()
  const host = (await request('POST', '/api/rooms', { local: true, playerCount: 2 })).body
  const base = '/api/rooms/' + host.view.code + '/'
  const cryptid = host.localSeats[1].token
  await request('POST', base + 'preference', { preference: 'cryptid' }, cryptid)
  await request('POST', base + 'start', {}, host.token)
  await request('POST', base + 'species', { species: 'Sasquatch' }, cryptid)
  for (const hunterClass of ['ranger', 'biker', 'trapper']) await request('POST', base + 'class', { hunterClass }, host.token)
  const command = { type: 'search', round: 1, requestId: 'search-artwork' }
  const first = await request('POST', base + 'actions', command, host.token)
  assert.equal(first.status, 200)
  assert.deepEqual(first.body.searchResults, { sector: CAMP, cards: [] })
  assert.equal((await request('POST', base + 'actions', command, host.token)).body.searchResults, undefined)
  for (const token of [host.token, cryptid]) {
    assert.equal((await request('GET', base + 'state', null, token)).body.searchResults, undefined)
  }
})
