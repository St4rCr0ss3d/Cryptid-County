import { randomUUID } from 'node:crypto'
import { CAMP, MAP, DIRECTIONS, directionNames, offsetSector, RULES, GEAR, SPECIES, EVIDENCE, CHARGE_GROWTHS, CRYPTIDS, HUNTER_CLASSES } from './config.js'

const id = randomUUID
const pick = (items, random) => items[Math.floor(random() * items.length)]
const known = (table, key) => typeof key === 'string' && Object.hasOwn(table, key)
const populations = Object.entries(SPECIES).flatMap(([species, def]) =>
  def.spawns.map(pos => ({ species, pos })))

export class RuleError extends Error {}
function requireRule(condition, message) {
  if (!condition) throw new RuleError(message)
}

export function createMatch(players, species = 'Sasquatch', random = Math.random) {
  const hunters = players.filter(player => player.role === 'hunter').map((player, index) => {
    const { startingPack, blockades = 0 } = HUNTER_CLASSES[player.hunterClass] ?? {}
    return {
      ...player, index, pos: CAMP, ap: RULES.actions, ended: false, cargo: [], digital: [],
      gear: startingPack ? [{ id: id(), type: startingPack, qty: GEAR[startingPack].size }] : [],
      restraint: null, blockades, bikeUsed: false,
    }
  })
  const budget = RULES[hunters.length]
  const cryptid = {
    ...players.find(player => player.role === 'cryptid'), species,
    pos: pick(['B1', 'D1', 'F1', 'F2', 'G3'], random), ap: 0, hunger: RULES.startHunger,
    seen: null, lastSeen: null, restraint: null, memories: {}, charges: 0,
  }
  const state = {
    hunters, cryptid, random, phase: 'hunters', round: 1, winner: null,
    cash: RULES.startingCash + hunters.reduce((total, hunter) => total + (HUNTER_CLASSES[hunter.hunterClass]?.bonusCash ?? 0), 0),
    upkeep: budget.upkeep, sales: {}, duplicates: {},
    cache: { id: CAMP, pos: CAMP, gear: [], cargo: [] }, devices: [], cryptidSnares: [],
    chargeGrowths: CHARGE_GROWTHS.slice(0, CRYPTIDS[species]?.chargePickups ?? 0).map(pos => ({ id: id(), pos })),
    animals: populations.map(animal => ({ ...animal, id: id(), status: 'alive', tagged: false, observation: null })),
    clues: [], gas: new Map(), logs: { hunters: [], cryptid: [] }, warnings: {},
  }
  log(state, 'hunters', 'The expedition has begun. Use the base camp shop to equip your team.')
  log(state, 'cryptid', 'Hunters have entered the county.')
  return state
}

function log(state, side, message) {
  const history = state.logs[side]
  history.unshift({ round: state.round, message })
  if (history.length > 80) history.pop()
}

export const equipmentAt = (device, pos) => device.pos === pos || device.to === pos
export const equipmentCapacity = hunter => HUNTER_CLASSES[hunter.hunterClass]?.equipment ?? RULES.equipment
export const hasTrailCamera = (state, pos) => state.devices.some(device => device.type === 'camera' && device.pos === pos)
export const hasFreeSnarePlacement = (state, hunter) => hunter.hunterClass === 'trapper' && hunter.freeSnareRound !== state.round
const localDevices = (state, pos) => state.devices.filter(device => equipmentAt(device, pos))
const hasBlockade = (devices, from, to) => devices.some(device => device.type === 'blockade' &&
  equipmentAt(device, from) && equipmentAt(device, to))
export function hunterEquipment(state) {
  return [...state.devices, ...state.clues.flatMap(clue => clue.device && !clue.discovery ? [clue.device] : [])]
    .sort((first, second) => first.id.localeCompare(second.id))
}
const living = (state, pos) => state.animals.filter(animal => animal.status === 'alive' && animal.pos === pos)
const currentHunter = (state, actor) => state.hunters.find(hunter => hunter.id === actor)
const hasPack = (hunter, type) => hunter.gear.some(pack => pack.type === type && pack.qty > 0)
export const isLive = (state, clue) => state.round - clue.round < (clue.type === 'tracks' ? RULES.footprintLife : RULES.otherClueLife)
const localClues = (state, pos) => state.clues.filter(clue => clue.pos === pos && clue.discovery && !clue.collected && isLive(state, clue))
const localAnimals = (state, pos) => {
  const camera = hasTrailCamera(state, pos)
  return living(state, pos).filter(animal => camera || animal.tagged || animal.observation?.live)
}
const atSite = (state, hunter, target) => {
  const sites = [...localDevices(state, hunter.pos).filter(device => device.type === 'tent')]
  if (hunter.pos === CAMP) sites.unshift(state.cache)
  return sites.find(site => site.id === target) ?? (target == null ? sites[0] : null)
}

function createClue(state, type, pos, details = {}) {
  const clue = { id: id(), type, pos, round: state.round, ...details }
  state.clues.push(clue)
  return clue
}

function discover(state, clue, exact = false) {
  clue.discovery ??= { round: state.round, exact: false }
  clue.discovery.exact ||= exact
}

function reveal(state, cameraOnly = false) {
  const cryptid = state.cryptid
  if (cryptid.seen) {
    if (!cameraOnly) delete cryptid.seen.cameraOnly
    return cryptid.seen
  }
  const clue = createClue(state, 'sighting', cryptid.pos, cameraOnly ? { cameraOnly } : {})
  discover(state, clue)
  cryptid.seen = clue
  const subject = cameraOnly ? 'Trail camera sighted the Cryptid at ' : 'Cryptid sighted at '
  log(state, 'hunters', subject + cryptid.pos + '.')
  return clue
}

function endSighting(state, pos) {
  state.cryptid.lastSeen = { pos, round: state.round }
  state.cryptid.seen = null
}

function removeDevice(state, device) {
  state.devices = state.devices.filter(item => item !== device)
  if (device.type !== 'camera') return
  device.activated = null
  const { cryptid } = state
  if (device.pos === cryptid.pos && cryptid.seen?.cameraOnly && !hasTrailCamera(state, device.pos)) {
    endSighting(state, device.pos)
  }
}

function takePhoto(hunter, clue, details = {}) {
  clue.photographers ??= []
  clue.photographers.push(hunter.id)
  hunter.digital.push({ id: id(), type: clue.type, source: clue.id, photo: true, ...details })
}

function breakDevice(state, device, cryptidKnows = false) {
  removeDevice(state, device)
  if (cryptidKnows) delete state.cryptid.memories[device.id]
  for (const animal of state.animals) {
    if (animal.snare === device.id) animal.snare = null
  }
  for (const animal of device.cargo) {
    animal.status = 'ground'
    animal.pos = device.pos
    animal.groundFound = false
  }
  createClue(state, 'damage', device.pos, { device, cryptidKnows })
}

function breakRestraint(state) {
  const restraint = state.cryptid.restraint
  if (!restraint) return
  if (restraint.device) {
    const device = localDevices(state, state.cryptid.pos).find(item => item.id === restraint.device)
    if (device) breakDevice(state, device, true)
  }
  state.cryptid.restraint = null
}

function triggerSnare(state) {
  const cryptid = state.cryptid
  const snare = localDevices(state, cryptid.pos).find(device => device.type === 'snare' && device.activated == null)
  if (!snare || cryptid.restraint) return false
  cryptid.restraint = { device: snare.id }
  rememberDevice(state, snare)
  snare.activated = state.round
  log(state, 'hunters', 'Snare activated at ' + cryptid.pos + '.')
  log(state, 'cryptid', 'A snare at ' + cryptid.pos + ' has restrained you.')
  return true
}

function triggerHunterSnare(state, hunter) {
  if (hunter.restraint) return false
  const snare = state.cryptidSnares.find(item => item.pos === hunter.pos && item.activated == null)
  if (!snare) return false
  snare.discovered = true
  snare.activated = state.round
  hunter.restraint = { device: snare.id }
  log(state, 'hunters', hunter.name + ' was caught in a Cryptid snare at ' + hunter.pos + '.')
  log(state, 'cryptid', 'Your snare restrained ' + hunter.name + ' at ' + hunter.pos + '.')
  return true
}

function breakHunterRestraint(state, hunter) {
  if (!hunter.restraint) return
  state.cryptidSnares = state.cryptidSnares.filter(snare => snare.id !== hunter.restraint.device)
  hunter.restraint = null
}

function triggerAnimalSnare(state, animal) {
  if (animal.snare || animal.status !== 'alive') return
  const traps = [...localDevices(state, animal.pos).filter(device => device.type === 'snare'),
    ...state.cryptidSnares.filter(snare => snare.pos === animal.pos)]
  const snare = traps.find(trap => trap.activated == null)
  if (!snare) return
  animal.snare = snare.id
  snare.activated = state.round
  log(state, snare.type === 'snare' ? 'hunters' : 'cryptid', 'Snare activated at ' + animal.pos + '.')
}

function releaseAnimalSnare(state, animal, broken = false) {
  if (!animal.snare) return
  const trap = [...state.devices, ...state.cryptidSnares].find(device => device.id === animal.snare)
  animal.snare = null
  if (!trap) return
  if (!broken) trap.activated = null
  else if (trap.type === 'snare') breakDevice(state, trap)
  else state.cryptidSnares = state.cryptidSnares.filter(snare => snare !== trap)
}

function record(device, type, event) {
  device.recordings.push({ id: id(), type, source: event })
}

function updateDevices(state, event) {
  for (const device of state.devices) {
    if (device.type !== 'camera' && device.type !== 'detector') continue
    const previous = device.occupants
    const occupants = living(state, device.pos).map(animal => animal.id)
    if (state.cryptid.pos === device.pos) occupants.push(state.cryptid.id)
    const entering = occupants.filter(actor => !previous.includes(actor))
    if (!previous.length && occupants.length) {
      device.activated = state.round
      log(state, 'hunters', GEAR[device.type].unit + ' activated at ' + device.pos + '.')
    } else if (previous.length && !occupants.length) {
      device.activated = null
    }
    if (device.type === 'camera') {
      if (state.cryptid.pos === device.pos) reveal(state, true)
      for (const actor of entering) {
        const type = actor === state.cryptid.id ? 'cryptidVideo' : 'animalVideo'
        event[actor] ??= id()
        record(device, type, event[actor])
      }
    }
    device.occupants = occupants
  }
}

function behaviorFootage(state, source) {
  for (const device of localDevices(state, state.cryptid.pos)) {
    if (device.type === 'camera') record(device, 'behaviorVideo', source)
  }
}

function inspectArrival(state, hunter) {
  triggerHunterSnare(state, hunter)
  const { pos } = hunter
  const { cryptid } = state
  if (pos === cryptid.pos && (pos === cryptid.lastSeen?.pos || cryptid.restraint?.device || cryptid.seen?.cameraOnly)) reveal(state)
  for (const animal of living(state, pos)) {
    if (animal.snare) animal.observation = { pos, round: state.round, live: true }
  }
  for (const animal of state.animals) {
    if (!animal.tagSignal?.scat || animal.tagSignal.pos !== hunter.pos) continue
    animal.tagged = false
    delete animal.tagSignal
    takePhoto(hunter, { id: id(), type: 'scat' })
    log(state, 'hunters', hunter.name + ' photographed scat at ' + hunter.pos + ' and found a broken tag.')
  }
  for (const clue of state.clues.filter(item => item.device && equipmentAt(item.device, hunter.pos) && !item.collected)) {
    if (clue.photographers?.includes(hunter.id)) continue
    discover(state, clue, true)
    const damageAge = state.round - clue.round
    takePhoto(hunter, clue, { brokenRound: clue.round })
    const age = damageAge === 0 ? 'this round' : damageAge + (damageAge === 1 ? ' round ago' : ' rounds ago')
    log(state, 'hunters', hunter.name + ' photographed a broken ' + GEAR[clue.device.type].unit.toLowerCase() +
      ' at ' + hunter.pos + '. It broke ' + age + '.')
  }
  for (const device of localDevices(state, hunter.pos)) {
    if (device.type === 'camera' && device.recordings.length) {
      const tapes = device.recordings.splice(0)
      hunter.digital.push(...tapes)
      log(state, 'hunters', hunter.name + ' retrieved ' + tapes.length + (tapes.length === 1 ? ' video tape' : ' video tapes') + ' at ' + hunter.pos + '.')
    }
  }
}

function moveHunter(state, hunter, to) {
  hunter.pos = to
  refreshObservations(state)
  inspectArrival(state, hunter)
}

function rememberDevice(state, { id, type, pos, to }) {
  state.cryptid.memories[id] = { id, type, pos, to }
}

function rememberEquipment(state, pos) {
  const { cryptid } = state
  for (const [key, memory] of Object.entries(cryptid.memories)) {
    if (equipmentAt(memory, pos)) delete cryptid.memories[key]
  }
  const equipment = localDevices(state, pos)
  for (const device of equipment) rememberDevice(state, device)
  return equipment.length
}

export function canCryptidTravel(state, from, to) {
  return !state.gas.has(to) && !hasBlockade(state.devices, from, to)
}

export function blockadeTargets(state, hunter) {
  if (hunter.hunterClass !== 'ranger' || !hunter.blockades) return []
  const equipment = hunterEquipment(state)
  return Object.values(MAP[hunter.pos].exits).filter(to => !hasBlockade(equipment, hunter.pos, to))
}

export function bikeRoutes(hunter) {
  if (hunter.hunterClass !== 'biker' || hunter.bikeUsed) return []
  return Object.entries(MAP[hunter.pos].exits).flatMap(([direction, via]) => {
    const to = MAP[via].exits[direction]
    return to ? [{ to, via }] : []
  })
}

export function flyDestinations(state) {
  return Object.keys(DIRECTIONS).flatMap(dir => {
    const to = offsetSector(state.cryptid.pos, dir, 2)
    return to && !state.gas.has(to) ? [{ dir, to }] : []
  })
}

function moveCryptid(state, to, { flying = false } = {}) {
  const cryptid = state.cryptid
  const from = cryptid.pos
  const dir = Object.keys(MAP[from].exits).find(key => MAP[from].exits[key] === to)
  if (!flying && MAP[from].type !== 'r') createClue(state, 'tracks', from, { dir })
  if (cryptid.seen) endSighting(state, cryptid.seen.cameraOnly ? from : to)
  cryptid.pos = to
  rememberEquipment(state, to)
  if (state.hunters.some(hunter => hunter.pos === to)) reveal(state)
  triggerSnare(state)
}

function refreshObservations(state) {
  for (const animal of state.animals) {
    if (animal.observation?.live && (animal.status !== 'alive' ||
      animal.pos !== animal.observation.pos || !state.hunters.some(hunter => hunter.pos === animal.pos))) {
      animal.observation.live = false
    }
  }
}

export function wildlifeWeights(space, species) {
  const definition = SPECIES[species]
  const possible = Object.entries(DIRECTIONS).map(([dir, [dx, dy]]) => {
    const terrain = MAP[String.fromCharCode(65 + space.x + dx) + (space.y + dy + 1)]?.type
    return { dir, pos: space.exits[dir], preferred: Boolean(terrain && definition.preferred.includes(terrain)) }
  })
  possible.push({ dir: 'stay', pos: space.id, preferred: definition.preferred.includes(space.type) })
  const preferred = possible.filter(outcome => outcome.preferred).length
  const legal = possible.filter(outcome => outcome.pos &&
    (outcome.dir === 'stay' || definition.allowed.includes(MAP[outcome.pos].type)))
    .map(outcome => ({ ...outcome, probability: preferred ? .15 + (outcome.preferred ? .25 / preferred : 0) : .2 }))
  const sum = legal.reduce((total, outcome) => total + outcome.probability, 0)
  return legal.map(outcome => ({ ...outcome, probability: outcome.probability / sum }))
}

function advanceWildlife(state) {
  for (const animal of state.animals.filter(animal => animal.status === 'alive')) {
    const choices = wildlifeWeights(MAP[animal.pos], animal.species)
    let roll = state.random()
    const destination = (choices.find(choice => (roll -= choice.probability) < 0) ?? choices.at(-1)).pos
    if (destination === animal.pos) continue
    if (animal.snare) {
      releaseAnimalSnare(state, animal, true)
      continue
    }
    animal.pos = destination
    triggerAnimalSnare(state, animal)
  }
  refreshObservations(state)
  updateDevices(state, {})
  state.phase = 'cryptid'
  state.cryptid.hunger = Math.min(RULES.maxHunger, state.cryptid.hunger + 1)
  state.cryptid.ap = RULES.actions
  log(state, 'hunters', 'Wildlife has moved. The Cryptid is taking its turn.')
  log(state, 'cryptid', 'Your turn. Hunger is ' + state.cryptid.hunger + '/' + RULES.maxHunger + '.')
}

function finishCryptidTurn(state) {
  const { cryptid } = state
  cryptid.ap = 0
  for (const { tagSignal } of state.animals) {
    if (tagSignal?.followThrough !== state.round) continue
    tagSignal.followThrough = null
    tagSignal.pos = cryptid.pos
    tagSignal.scat = true
  }
  if (cryptid.hunger === RULES.maxHunger) {
    const target = MAP[cryptid.pos]
    for (const hunter of state.hunters) {
      const origin = MAP[hunter.pos]
      const dx = target.x - origin.x
      const dy = target.y - origin.y
      const dir = !dx && !dy ? 'here' : Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N')
      state.warnings[hunter.id] = { dir, round: state.round }
    }
    log(state, 'hunters', 'A starving Cryptid has given away its direction.')
    log(state, 'cryptid', 'Your hunger gave hunters a bearing.')
  }
  for (const [pos, lastRound] of state.gas) {
    if (state.round >= lastRound) state.gas.delete(pos)
  }
  state.cash = Math.max(0, state.cash - state.upkeep)
  if (!state.cash) {
    state.winner = 'cryptid'
    return
  }
  state.round++
  state.phase = 'hunters'
  for (const hunter of state.hunters) {
    hunter.ap = RULES.actions
    hunter.ended = false
    hunter.bikeUsed = false
  }
  log(state, 'hunters', 'Upkeep paid — $' + state.upkeep + '. Hunter phase begins.')
}

function usePack(hunter, type) {
  const index = hunter.gear.findIndex(pack => pack.type === type && pack.qty > 0)
  requireRule(index >= 0, 'You need ' + GEAR[type].name.toLowerCase() + '.')
  const pack = hunter.gear[index]
  pack.qty--
  if (!pack.qty && pack.type !== 'netgun') hunter.gear.splice(index, 1)
}

function addPack(packs, pack, maxSlots = Infinity) {
  // Check capacity before touching a partial pack. A failed transfer must be atomic.
  if (pack.type === 'netgun') {
    requireRule(packs.length < maxSlots, 'No free equipment slot.')
    packs.push(pack)
    return
  }
  const sameType = packs.filter(other => other.type === pack.type && other.qty < GEAR[pack.type].size)
  const freeUnits = sameType.reduce((sum, other) => sum + GEAR[pack.type].size - other.qty, 0)
  requireRule(freeUnits >= pack.qty || packs.length < maxSlots, 'No free equipment slot.')
  let remaining = pack.qty
  for (const other of sameType) {
    const amount = Math.min(remaining, GEAR[pack.type].size - other.qty)
    other.qty += amount
    remaining -= amount
  }
  if (remaining) packs.push({ ...pack, qty: remaining })
}

function quoteItems(items, evidence, sales, duplicates, mediaMultiplier) {
  const curve = evidence ? RULES.evidenceSaleCurve : RULES.meatSaleCurve
  return items.map(item => {
    const type = evidence ? item.type : item.species
    const key = (evidence ? 'evidence:' : 'animal:') + type
    const definition = evidence ? EVIDENCE[type] : SPECIES[type]
    const count = sales[key] ?? 0
    const repeats = evidence ? duplicates[item.source] ?? 0 : 0
    sales[key] = count + 1
    if (evidence) duplicates[item.source] = repeats + 1
    const price = Math.round(definition.price * (curve[count] ?? 0) * (curve[repeats] ?? 0))
    if (evidence && item.photo) return Math.round(Math.max(RULES.minPhotoPayout, price) * mediaMultiplier)
    if (evidence && definition.video) return Math.round(Math.max(RULES.minVideoPayout, price) * mediaMultiplier)
    return price
  })
}

export function assessEvidence(state, hunter) {
  const items = [...hunter.cargo.filter(item => !item.species), ...hunter.digital]
  const multiplier = HUNTER_CLASSES[hunter.hunterClass]?.mediaMultiplier ?? 1
  const values = quoteItems(items, true, { ...state.sales }, { ...state.duplicates }, multiplier)
  return new Map(items.map((item, index) => [item.id, values[index]]))
}

function cashOut(state, hunter, items, evidence) {
  const multiplier = HUNTER_CLASSES[hunter.hunterClass]?.mediaMultiplier ?? 1
  const prices = quoteItems(items, evidence, state.sales, state.duplicates, multiplier)
  const total = prices.reduce((sum, price) => sum + price, 0)
  if (!evidence) for (const item of items) item.status = 'sold'
  state.cash += total
  return total
}

function interactWithSite(state, hunter, command) {
  const site = atSite(state, hunter, command.site)
  requireRule(site, 'You must be at the selected site.')
  const camp = site === state.cache
  const { type, target } = command
  if (type === 'buy') {
    requireRule(camp && known(GEAR, target) && !GEAR[target].classGear, 'This item is not available to buy at camp.')
    const definition = GEAR[target]
    requireRule(state.cash >= definition.price, 'The expedition cannot afford this pack.')
    if (triggerHunterSnare(state, hunter)) return
    addPack(site.gear, { id: id(), type: target, qty: definition.size })
    state.cash -= definition.price
    log(state, 'hunters', hunter.name + ' bought ' + definition.name.toLowerCase() + ' for the camp cache.')
  } else if (type === 'sellMeat' || type === 'submit') {
    requireRule(type !== 'sellMeat' || camp, 'Meat can only be sold at base camp.')
    const evidence = type === 'submit'
    const cargo = hunter.cargo.filter(item => evidence ? !item.species : item.species)
    const items = evidence ? [...cargo, ...hunter.digital] : cargo
    requireRule(items.length, evidence ? 'You have no evidence to submit.' : 'You have no meat to sell.')
    if (triggerHunterSnare(state, hunter)) return
    const amount = cashOut(state, hunter, items, evidence)
    hunter.cargo = hunter.cargo.filter(item => !cargo.includes(item))
    if (evidence) hunter.digital = []
    log(state, 'hunters', hunter.name + (evidence ? ' submitted evidence' : ' sold meat') + ' for $' + amount + '.')
  } else if (type === 'storeCargo' || type === 'takeCargo') {
    const storing = type === 'storeCargo'
    const from = storing ? hunter.cargo : site.cargo
    const to = storing ? site.cargo : hunter.cargo
    const index = from.findIndex(item => item.id === target && item.species)
    requireRule(index >= 0, 'That carcass is no longer available.')
    requireRule(storing || to.length < RULES.cargo, 'No free cargo slot.')
    if (triggerHunterSnare(state, hunter)) return
    const [animal] = from.splice(index, 1)
    animal.status = storing ? 'cached' : 'carried'
    animal.owner = storing ? site.id : hunter.id
    animal.pos = site.pos
    to.push(animal)
  } else {
    const storing = type === 'storeGear'
    const from = storing ? hunter.gear : site.gear
    const to = storing ? site.gear : hunter.gear
    const index = from.findIndex(pack => pack.id === target)
    requireRule(index >= 0, 'That pack is no longer available.')
    const pack = from[index]
    if (type === 'swapGear') {
      const other = hunter.gear.findIndex(item => item.id === command.with)
      requireRule(other >= 0, 'Select a carried pack to swap.')
      if (triggerHunterSnare(state, hunter)) return
      const [carried] = hunter.gear.splice(other, 1, pack)
      site.gear.splice(index, 1)
      addPack(site.gear, carried)
    } else {
      if (triggerHunterSnare(state, hunter)) return
      addPack(to, pack, storing ? Infinity : equipmentCapacity(hunter))
      from.splice(index, 1)
    }
  }
}

function useGas(state, origin) {
  state.gas.set(origin, state.round + RULES.gasTurns - 1)
  const exits = Object.values(MAP[origin].exits)
  const occupants = state.hunters.filter(hunter => hunter.pos === origin)
  for (const hunter of occupants) {
    breakHunterRestraint(state, hunter)
    if (exits.length) hunter.pos = pick(exits, state.random)
  }
  for (const animal of living(state, origin)) {
    if (!exits.length) continue
    releaseAnimalSnare(state, animal, true)
    animal.pos = pick(exits, state.random)
    triggerAnimalSnare(state, animal)
  }
  if (state.cryptid.pos === origin) {
    breakRestraint(state)
    const cryptidExits = exits.filter(to => canCryptidTravel(state, origin, to))
    if (cryptidExits.length) moveCryptid(state, pick(cryptidExits, state.random))
  }
  refreshObservations(state)
  updateDevices(state, {})
  if (exits.length) {
    for (const hunter of occupants) inspectArrival(state, hunter)
  }
}

const siteActions = new Set(['buy', 'sellMeat', 'submit', 'storeGear', 'takeGear', 'swapGear', 'storeCargo', 'takeCargo'])
function hunterAction(state, hunter, command) {
  requireRule(state.phase === 'hunters' && !hunter.ended, 'You have already ended your hunter phase, or it is the Cryptid’s turn.')
  const { type, target } = command
  if (type === 'end') {
    hunter.ended = true
    if (state.hunters.every(member => member.ended)) advanceWildlife(state)
    return
  }
  const interrupted = () => triggerHunterSnare(state, hunter)
  if (type === 'escape') {
    requireRule(hunter.ap > 0 && hunter.restraint, 'Escaping a snare requires one action.')
    breakHunterRestraint(state, hunter)
    hunter.ap--
    log(state, 'hunters', hunter.name + ' escaped a Cryptid snare.')
    return
  }
  requireRule(!hunter.restraint, 'Escape the snare before acting.')
  if (siteActions.has(type)) {
    interactWithSite(state, hunter, command)
    if (state.cash === 0) state.winner = 'cryptid'
    return
  }
  if (type === 'dropCargo') {
    const index = hunter.cargo.findIndex(item => item.id === target && item.species)
    requireRule(index >= 0, 'You do not carry that carcass.')
    if (interrupted()) return
    const [animal] = hunter.cargo.splice(index, 1)
    animal.status = 'ground'
    animal.pos = hunter.pos
    animal.groundFound = true
    return
  }
  const freeSnare = type === 'deploy' && target === 'snare' && hasFreeSnarePlacement(state, hunter)
  requireRule(hunter.ap > 0 || freeSnare, 'You have no actions left this round.')
  const pos = hunter.pos
  const { cryptid } = state
  switch (type) {
    case 'move':
      requireRule(Object.values(MAP[pos].exits).includes(target), 'There is no route to that space.')
      moveHunter(state, hunter, target)
      break
    case 'bike': {
      const route = bikeRoutes(hunter).find(option => option.to === target)
      requireRule(route, 'A bike move requires two connected sectors in a straight line and can be used once per round.')
      hunter.bikeUsed = true
      moveHunter(state, hunter, route.via)
      if (!hunter.restraint) moveHunter(state, hunter, route.to)
      break
    }
    case 'blockade': {
      requireRule(blockadeTargets(state, hunter).includes(target), 'A Park Ranger with a spare blockade can close a connected trail.')
      if (interrupted()) return
      const blockade = { id: id(), type: 'blockade', pos, to: target, cargo: [] }
      state.devices.push(blockade)
      hunter.blockades--
      if (equipmentAt(blockade, cryptid.pos)) rememberDevice(state, blockade)
      log(state, 'hunters', hunter.name + ' blocked the trail between ' + pos + ' and ' + target + '.')
      break
    }
    case 'search': {
      if (interrupted()) return
      const animals = living(state, pos)
      for (const animal of animals) animal.observation = { pos, round: state.round, live: true }
      for (const animal of state.animals.filter(item => item.status === 'ground' && item.pos === pos)) animal.groundFound = true
      const clues = state.clues.filter(clue => clue.pos === pos && !clue.collected && isLive(state, clue) &&
        (!clue.device || clue.discovery) &&
        (clue.type !== 'sighting' || clue === cryptid.seen))
      for (const clue of clues) discover(state, clue, hasPack(hunter, 'kit'))
      if (cryptid.pos === pos) {
        const sighting = reveal(state)
        if (!clues.includes(sighting)) clues.push(sighting)
      }
      const photos = clues.filter(clue => EVIDENCE[clue.type].price > 0 && !clue.photographers?.includes(hunter.id))
      if (!clues.length) {
        const teammate = state.hunters.some(member => member !== hunter && member.pos === pos)
        const equipment = hunterEquipment(state).some(device => equipmentAt(device, pos)) ||
          state.cryptidSnares.some(snare => snare.pos === pos && snare.discovered)
        photos.push({ id: id(), type: teammate ? 'groupPhoto' : equipment ? 'gearPhoto' : 'naturePhoto' })
      }
      for (const clue of photos) takePhoto(hunter, clue)
      log(state, 'hunters', hunter.name + ' searched ' + pos + ' and found ' + animals.length + ' wildlife and ' + clues.length + ' clues.' +
        (photos.length ? ' Photos saved: ' + photos.length + '.' : ''))
      break
    }
    case 'shoot':
      requireRule(cryptid.pos === pos && cryptid.seen, 'Confirm the Cryptid in your space first.')
      requireRule(!cryptid.restraint, 'The Cryptid is already restrained.')
      requireRule(hasPack(hunter, 'netgun'), 'You need a loaded netgun.')
      if (interrupted()) return
      usePack(hunter, 'netgun')
      cryptid.restraint = { device: null }
      log(state, 'hunters', hunter.name + ' netted the Cryptid at ' + pos + '.')
      break
    case 'capture':
      requireRule(cryptid.pos === pos && cryptid.seen && cryptid.restraint, 'Capture requires a confirmed, restrained Cryptid in your space.')
      if (interrupted()) return
      state.winner = 'hunters'
      log(state, 'hunters', hunter.name + ' captured the Cryptid at ' + pos + '.')
      log(state, 'cryptid', 'You were captured at ' + pos + '.')
      break
    case 'deploy':
      requireRule(known(GEAR, target) && GEAR[target].deploy, 'Select deployable equipment.')
      requireRule(hasPack(hunter, target), 'You need ' + GEAR[target].name.toLowerCase() + '.')
      if (interrupted()) return
      usePack(hunter, target)
      if (freeSnare) hunter.freeSnareRound = state.round
      state.devices.push({
        id: id(), type: target, pos, occupants: [], activated: null, recordings: [], gear: [], cargo: [],
      })
      if (target === 'snare') for (const animal of living(state, pos)) triggerAnimalSnare(state, animal)
      updateDevices(state, {})
      log(state, 'hunters', hunter.name + ' deployed a ' + GEAR[target].unit.toLowerCase() + ' at ' + pos + '.')
      break
    case 'recover': {
      const device = localDevices(state, pos).find(item => item.id === target)
      requireRule(device && !(device.type === 'snare' && device.activated != null), 'That device cannot be recovered.')
      requireRule(!GEAR[device.type].classGear || hunter.hunterClass === 'ranger', 'Only the Park Ranger can recover a trail blockade.')
      requireRule(device.type !== 'tent' || (!device.gear.length && !device.cargo.length), 'Empty the tent cache first.')
      if (interrupted()) return
      if (device.type === 'blockade') {
        hunter.blockades++
        if (equipmentAt(device, cryptid.pos)) delete cryptid.memories[device.id]
        log(state, 'hunters', hunter.name + ' recovered the blockade on ' + device.pos + '–' + device.to + '.')
      } else {
        addPack(hunter.gear, { id: id(), type: device.type, qty: 1 }, equipmentCapacity(hunter))
        hunter.digital.push(...device.recordings)
      }
      removeDevice(state, device)
      break
    }
    case 'hunt':
    case 'tag': {
      const animal = localAnimals(state, pos).find(item => item.id === target)
      requireRule(animal, 'Search for that animal in your space first.')
      if (type === 'tag') {
        requireRule(!animal.tagged, 'This animal already has a tag.')
        requireRule(hasPack(hunter, 'tag'), 'You need animal tags.')
        if (interrupted()) return
        usePack(hunter, 'tag')
        animal.tagged = true
      } else {
        requireRule(hunter.cargo.length < RULES.cargo, 'No free cargo slot.')
        if (interrupted()) return
        releaseAnimalSnare(state, animal)
        animal.status = 'carried'
        animal.owner = hunter.id
        animal.observation = null
        hunter.cargo.push(animal)
        updateDevices(state, {})
      }
      log(state, 'hunters', hunter.name + (type === 'tag' ? ' tagged ' : ' harvested ') + SPECIES[animal.species].name.toLowerCase() + ' at ' + pos + '.')
      break
    }
    case 'takeGround': {
      const animal = state.animals.find(item => item.id === target && item.status === 'ground' &&
        item.pos === pos && (item.groundFound || item.tagged))
      requireRule(animal, 'No discovered carcass is available here.')
      requireRule(hunter.cargo.length < RULES.cargo, 'No free cargo slot.')
      if (interrupted()) return
      animal.status = 'carried'
      animal.owner = hunter.id
      hunter.cargo.push(animal)
      break
    }
    case 'photo':
    case 'collect': {
      const clue = localClues(state, pos).find(item => item.id === target &&
        (item.type !== 'sighting' || item === cryptid.seen))
      requireRule(clue, 'That evidence is no longer available in your space.')
      if (type === 'photo') {
        requireRule(!clue.photographers?.includes(hunter.id), 'You already photographed this event.')
        if (interrupted()) return
        takePhoto(hunter, clue)
      } else {
        requireRule(EVIDENCE[clue.type].collectible, 'This clue is not a collectible sample.')
        requireRule(hunter.cargo.length < RULES.cargo, 'No free cargo slot.')
        if (interrupted()) return
        clue.collected = true
        hunter.cargo.push({ id: id(), type: clue.type, source: clue.id })
      }
      break
    }
    case 'gas':
      requireRule(hasPack(hunter, 'gas'), 'You need tear gas.')
      if (interrupted()) return
      usePack(hunter, 'gas')
      useGas(state, pos)
      log(state, 'hunters', 'Tear gas deployed at ' + pos + '.')
      break
    case 'reload': {
      const gun = hunter.gear.find(item => item.id === target && item.type === 'netgun')
      const ammo = hunter.gear.find(item => item.type === 'ammo')
      requireRule(gun && ammo && gun.qty < GEAR.netgun.size, 'You need a netgun with room and spare ammunition.')
      if (interrupted()) return
      const shots = Math.min(ammo.qty, GEAR.netgun.size - gun.qty)
      gun.qty += shots
      ammo.qty -= shots
      if (!ammo.qty) hunter.gear = hunter.gear.filter(item => item !== ammo)
      break
    }
    default:
      throw new RuleError('Unknown hunter action.')
  }
  if (!freeSnare) hunter.ap--
}

function useAbility(state, target) {
  const { cryptid } = state
  requireRule(cryptid.charges > 0, 'Feed on a charge growth before using your ability.')
  const { species, pos } = cryptid
  if (species === 'Mothman') {
    const destination = flyDestinations(state).find(({ dir }) => dir === target)
    requireRule(destination, 'Choose an open landing sector outside tear gas.')
    behaviorFootage(state, id())
    moveCryptid(state, destination.to, { flying: true })
    updateDevices(state, {})
    log(state, 'cryptid', 'You flew ' + directionNames[destination.dir] + ' to ' + destination.to + '.')
  } else {
    if (triggerSnare(state)) return false
    behaviorFootage(state, id())
    if (species === 'Sasquatch') {
      const nearby = [pos, ...Object.keys(DIRECTIONS).map(dir => offsetSector(pos, dir)).filter(Boolean)]
      const count = nearby.reduce((sum, sector) => sum + rememberEquipment(state, sector), 0)
      log(state, 'cryptid', 'You sensed ' + count + ' pieces of hunter equipment.')
    } else {
      state.cryptidSnares.push({ id: id(), pos, discovered: false, activated: null })
      for (const animal of living(state, pos)) triggerAnimalSnare(state, animal)
      log(state, 'cryptid', 'You set a snare at ' + pos + '.')
    }
  }
  cryptid.charges--
  return true
}

function cryptidAction(state, command) {
  const cryptid = state.cryptid
  requireRule(state.phase === 'cryptid', 'The hunters are still taking their turn.')
  const { type, target } = command
  if (type === 'end') {
    finishCryptidTurn(state)
    return
  }
  requireRule(cryptid.ap > 0, 'You have no actions left this round.')
  const pos = cryptid.pos
  if (type === 'move') {
    requireRule(!cryptid.restraint, 'Escape the restraint before moving.')
    requireRule(Object.values(MAP[pos].exits).includes(target) && canCryptidTravel(state, pos, target), 'There is no legal route to that space.')
    moveCryptid(state, target)
    updateDevices(state, {})
  } else if (type === 'escape') {
    requireRule(cryptid.restraint, 'You are not restrained.')
    breakRestraint(state)
    log(state, 'cryptid', 'You escaped the restraint.')
  } else {
    requireRule(!cryptid.restraint, 'Escape the restraint before acting.')
    if (type === 'ability') {
      requireRule(known(CRYPTIDS, cryptid.species), 'This Cryptid has no special ability.')
      if (!useAbility(state, target)) return
    } else if (type === 'feedGrowth') {
      const index = state.chargeGrowths.findIndex(growth => growth.id === target && growth.pos === pos)
      requireRule(index >= 0, 'There is no such charge growth in this space.')
      if (triggerSnare(state)) return
      state.chargeGrowths.splice(index, 1)
      cryptid.charges++
      behaviorFootage(state, id())
      log(state, 'cryptid', 'You fed on a charge growth and gained one ability charge.')
    } else if (type === 'feed') {
      const animal = state.animals.find(item => item.id === target && item.pos === pos &&
        (item.status === 'alive' || item.status === 'ground'))
      requireRule(animal, 'There is no such food in this space.')
      if (triggerSnare(state)) return
      releaseAnimalSnare(state, animal)
      if (animal.tagged) {
        animal.tagSignal = {
          pos, status: animal.status,
          followThrough: state.random() < RULES.tagRemainsChance ? null : state.round + 1,
        }
        animal.observation = null
      }
      animal.status = 'consumed'
      if (animal.observation) animal.observation.live = false
      cryptid.hunger = Math.max(0, cryptid.hunger - SPECIES[animal.species].food)
      const clue = createClue(state, 'feed', pos)
      behaviorFootage(state, clue.id)
      updateDevices(state, {})
      log(state, 'cryptid', 'You fed on a ' + SPECIES[animal.species].name.toLowerCase() + '.')
    } else if (type === 'destroy') {
      const device = localDevices(state, pos).find(item => item.id === target && cryptid.memories[item.id])
      requireRule(device, 'That equipment is not available to destroy.')
      if (triggerSnare(state)) return
      breakDevice(state, device, true)
      log(state, 'cryptid', 'You destroyed a ' + GEAR[device.type].unit.toLowerCase() + '.')
    } else if (type === 'mislead') {
      requireRule(known(MAP[pos].exits, target) && MAP[pos].type !== 'r', 'Choose a legal direction on terrain that holds tracks.')
      if (triggerSnare(state)) return
      const clue = createClue(state, 'tracks', pos, { dir: target, falseTrail: true })
      behaviorFootage(state, clue.id)
      log(state, 'cryptid', 'You left false tracks heading ' + directionNames[target] + '.')
    } else {
      throw new RuleError('Unknown Cryptid action.')
    }
  }
  cryptid.ap--
  if (!cryptid.ap) finishCryptidTurn(state)
}

export function act(state, actor, command) {
  requireRule(!state.winner, 'The expedition has ended.')
  requireRule(command && typeof command.type === 'string', 'Choose an action.')
  const hunter = currentHunter(state, actor)
  if (hunter) return hunterAction(state, hunter, command)
  requireRule(state.cryptid.id === actor, 'You do not have a seat in this match.')
  return cryptidAction(state, command)
}
