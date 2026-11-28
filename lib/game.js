import { randomUUID } from 'node:crypto'
import { CAMP, MAP, DIRECTIONS, directionNames, offsetSector, RULES, GEAR, SPECIES, EVIDENCE, CRYPTIDS, HUNTER_CLASSES, CRYPTID_ACTION_COST, SNEAK_MOVEMENT_COST, gearAvailable } from './config.js'

const id = randomUUID
const pick = (items, random) => items[Math.floor(random() * items.length)]
const known = (table, key) => typeof key === 'string' && Object.hasOwn(table, key)
const populations = Object.entries(SPECIES).flatMap(([species, def]) =>
  def.spawns.map(pos => ({ species, pos })))

export class RuleError extends Error {}
function requireRule(condition, message) {
  if (!condition) throw new RuleError(message)
}

export function createMatch(players, species = 'Sasquatch', random = Math.random, faction = 'researchers') {
  const hunters = players.filter(player => player.role === 'hunter').map((player, index) => {
    const { startingPack, blockades = 0 } = HUNTER_CLASSES[player.hunterClass] ?? {}
    return {
      ...player, index, pos: CAMP, ap: RULES.actions, movementSpent: 0, movementLost: false, ended: false, cargo: [], digital: [],
      gear: startingPack ? [{ id: id(), type: startingPack, qty: GEAR[startingPack].size }] : [],
      restraint: null, blockades, bikePos: player.hunterClass === 'biker' ? CAMP : undefined,
    }
  })
  const budget = RULES[hunters.length]
  const supportGrant = budget.supportGrant ?? 0
  const cryptid = {
    ...players.find(player => player.role === 'cryptid'), species,
    pos: pick(['B1', 'D1', 'F1', 'F2', 'G3'], random), ap: 0, movement: 0, movementLost: false, hunger: RULES.startHunger,
    seen: null, lastSeen: null, restraint: null, memories: {}, foraged: false, wounded: false, presenceEvent: id(), goalMarks: new Map(), ultimateUnlocked: false,
  }
  const state = {
    hunters, cryptid, random, faction, proof: new Map(), searchedSectors: new Map(hunters.map(hunter => [hunter.id, new Set()])), phase: 'hunters', round: 1, winner: null,
    supportGrant,
    cash: RULES.startingCash + supportGrant + hunters.reduce((total, hunter) => total + (HUNTER_CLASSES[hunter.hunterClass]?.bonusCash ?? 0), 0),
    upkeep: budget.upkeep, sales: {}, duplicates: {},
    cache: { id: CAMP, pos: CAMP, gear: [], cargo: [] }, devices: [], cryptidSnares: [],
    animals: populations.map(animal => ({ ...animal, id: id(), status: 'alive', tagged: false, observation: null })),
    clues: [], gas: new Map(), logs: { hunters: [], cryptid: [] }, warnings: {},
  }
  log(state, 'hunters', 'The expedition has begun. Use the base camp shop to equip your team.')
  log(state, 'cryptid', 'Hunters have entered the county.')
  return state
}

function log(state, side, message, equipmentAlert = false) {
  const history = state.logs[side]
  history.unshift({ round: state.round, message, ...(equipmentAlert ? { equipmentAlert: true } : {}) })
  if (history.length > 80) history.pop()
}

export const equipmentAt = (device, pos) => device.pos === pos || device.to === pos
export const canDestroyEquipment = device => device.type !== 'blockade'
export const occupiedSnare = (state, device) => state.cryptid.restraint?.device === device.id ||
  state.animals.some(animal => animal.snare === device.id)
const searchHistory = (state, hunter) => state.searchedSectors.get(hunter.id)
export const hasSearchedHere = (state, hunter, pos = hunter.pos) => searchHistory(state, hunter).has(pos)
export const equipmentCapacity = hunter => HUNTER_CLASSES[hunter.hunterClass]?.equipment ?? RULES.equipment
export const cargoCapacity = hunter => HUNTER_CLASSES[hunter.hunterClass]?.cargo ?? RULES.cargo
export const deployCost = (state, hunter, type) => HUNTER_CLASSES[hunter.hunterClass]?.freeDeploy?.includes(type) &&
  hunter.freeDeployRound !== state.round ? 0 : 1
export const isFootprint = type => type === 'tracks' || type === 'animalTracks'
export const isTrail = type => isFootprint(type) || type === 'blood'
export const trailAge = age => age <= 1 ? 'Fresh' : age === 2 ? '2 rounds ago' : 'Cold'
export const photoCost = (state, hunter, clueType) => !isFootprint(clueType) && clueType !== 'sighting' &&
  HUNTER_CLASSES[hunter.hunterClass]?.freePhoto && hunter.freePhotoRound !== state.round ? 0 : RULES.searchAP
export const gasCost = (state, hunter) => HUNTER_CLASSES[hunter.hunterClass]?.freeGas && hunter.freeGasRound !== state.round ? 0 : 1
export const rifleCost = (state, hunter) => state.rangeMark?.round === state.round && state.rangeMark.pos === hunter.pos
  ? 1 : (HUNTER_CLASSES[hunter.hunterClass]?.rifleCost ?? 2)
export const shopPrice = (hunter, type) => HUNTER_CLASSES[hunter.hunterClass]?.discount?.includes(type)
  ? Math.floor(GEAR[type].price * .75) : GEAR[type].price
export const ultimateCooldown = state => Math.max(0, (state.cryptid.ultimateReadyRound ?? 0) - state.round)
export const cameraHasActivity = device => (device.recordingVersion ?? 0) > (device.checkedVersion ?? 0)
export const isVideoDevice = device => ['camera', 'lowLight'].includes(device.type)
const localDevices = (state, pos) => state.devices.filter(device => equipmentAt(device, pos))
const hasBlockade = (devices, from, to) => devices.some(device => device.type === 'blockade' &&
  equipmentAt(device, from) && equipmentAt(device, to))
export function hunterEquipment(state) {
  return [...state.devices, ...state.clues.flatMap(clue => clue.device && !clue.discovery ? [clue.device] : [])]
    .sort((first, second) => first.id.localeCompare(second.id))
}
export const wildlifeOnMap = state => state.cryptid.disguise ? [...state.animals, state.cryptid.disguise] : state.animals
const living = (state, pos) => wildlifeOnMap(state).filter(animal => animal.status === 'alive' && animal.pos === pos)

const hasPack = (hunter, type) => hunter.gear.some(pack => pack.type === type && pack.qty > 0)
export const isLive = (state, clue) => state.round - clue.round < (isFootprint(clue.type) ? RULES.footprintLife : RULES.otherClueLife)
const localClues = (state, pos) => state.clues.filter(clue => clue.pos === pos && clue.discovery && !clue.collected && isLive(state, clue))
const localAnimals = (state, pos) => living(state, pos).filter(animal => animal.tagged || animal.observation?.live)
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

function reveal(state, cameraId) {
  const cryptid = state.cryptid
  if (cryptid.disguise) return null
  if (cryptid.seen) {
    if (!cameraId) delete cryptid.seen.cameraId
    else if (cryptid.seen.cameraId) cryptid.seen.cameraId = cameraId
    return cryptid.seen
  }
  const clue = createClue(state, 'sighting', cryptid.pos, cameraId ? { cameraId } : {})
  discover(state, clue)
  cryptid.seen = clue
  const subject = cameraId ? 'Trail camera sighted the Cryptid at ' : 'Cryptid sighted at '
  log(state, 'hunters', subject + cryptid.pos + '.', Boolean(cameraId))
  return clue
}

function endSighting(state, pos) {
  state.cryptid.lastSeen = { pos, round: state.round }
  state.cryptid.seen = null
}

function removeDevice(state, device) {
  state.devices = state.devices.filter(item => item !== device)
  if (state.cryptid.seen?.cameraId === device.id) endSighting(state, device.pos)
  for (const animal of wildlifeOnMap(state)) {
    if (animal.observation?.camera === device.id) animal.observation.live = false
  }
}

export const canPhotograph = (hunter, clue) => !clue.paidPhotoTaken && !clue.photographers?.includes(hunter.id)

function takePhoto(state, hunter, clue, { paid = false, ...details } = {}) {
  if (paid) clue.paidPhotoTaken = true
  clue.photographers ??= []
  clue.photographers.push(hunter.id)
  hunter.digital.push({ id: id(), type: clue.type, source: clue.id, photo: true,
    ...(isTrail(clue.type) ? { trackAge: trailAge(state.round - clue.round) } : {}), ...details })
}

function breakDevice(state, device, cryptidKnows = false) {
  if (!canDestroyEquipment(device)) return
  removeDevice(state, device)
  if (cryptidKnows) delete state.cryptid.memories[device.id]
  for (const animal of wildlifeOnMap(state)) {
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

function markCryptidGoal(state, event, key, group) {
  const { cryptid } = state
  if (CRYPTIDS[cryptid.species].goal.event === event && !cryptid.goalMarks.has(key)) {
    cryptid.goalMarks.set(key, { group, night: state.round })
  }
}

export function cryptidGoal(state) {
  const { cryptid } = state
  const { description, target, nights, groups, groupLabel } = CRYPTIDS[cryptid.species].goal
  const marks = [...cryptid.goalMarks.values()]
  const requirements = []
  if (nights) requirements.push({ label: 'Nights', progress: new Set(marks.map(mark => mark.night)).size, target: nights })
  if (groups) requirements.push({ label: groupLabel, progress: new Set(marks.map(mark => mark.group)).size, target: groups })
  return { description, target, progress: marks.length, requirements }
}

function triggerSnare(state, event) {
  const cryptid = state.cryptid
  const trapType = cryptid.species === 'Sasquatch' ? 'anchor' :
    ({ fly: { Mothman: 'aerial' }, shriek: { 'Jersey Devil': 'resonance' }, feed: { Chupacabra: 'baitCage' }, radio: { Mimic: 'voiceTrap' } })[event]?.[cryptid.species]
  const snare = trapType && localDevices(state, cryptid.pos).find(device => device.type === trapType && !occupiedSnare(state, device))
  if (!snare || cryptid.restraint) return false
  cryptid.restraint = { device: snare.id }
  cryptid.movementLost = true
  cryptid.movement = 0
  rememberDevice(state, snare)
  snare.activated = state.round
  log(state, 'hunters', 'Snare activated at ' + cryptid.pos + '.', true)
  log(state, 'cryptid', 'A snare at ' + cryptid.pos + ' has restrained you.', true)
  return true
}

function triggerHunterSnare(state, hunter) {
  if (hunter.restraint || isMounted(hunter)) return false
  const snare = state.cryptidSnares.find(item => item.pos === hunter.pos && !state.hunters.some(member => member.restraint?.device === item.id))
  if (!snare) return false
  snare.discovered = true
  snare.activated = state.round
  hunter.restraint = { device: snare.id }
  hunter.movementLost = true
  log(state, 'hunters', hunter.name + ' was caught in a Cryptid snare at ' + hunter.pos + '.', true)
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
  const snare = localDevices(state, animal.pos).find(device => device.type === 'snare' && !occupiedSnare(state, device))
  if (!snare) return
  animal.snare = snare.id
  if (animal === state.cryptid.disguise) {
    state.cryptid.restraint = { device: snare.id }
    state.cryptid.movementLost = true
    state.cryptid.movement = 0
  }
  alertWildlifeSnare(state, snare)
}

function alertWildlifeSnare(state, snare) {
  if (!snare || snare.activated != null) return
  snare.activated = state.round
  log(state, 'hunters', 'Snare activated at ' + snare.pos + '.', true)
}

function releaseAnimalSnare(state, animal, broken = false) {
  if (!animal.snare) return
  const trap = state.devices.find(device => device.id === animal.snare)
  animal.snare = null
  if (!trap) return
  if (broken) breakDevice(state, trap)
}

function record(device, type, event) {
  device.recordings.push({ id: id(), type, source: event })
  device.recordingVersion = (device.recordingVersion ?? 0) + 1
}

function updateDevices(state, event) {
  for (const device of state.devices) {
    if (!isVideoDevice(device) && device.type !== 'detector') continue
    const previous = device.occupants
    const occupants = living(state, device.pos).map(animal => animal.id)
    if (state.cryptid.pos === device.pos && !state.cryptid.disguise) occupants.push(state.cryptid.id)
    const entering = occupants.filter(actor => !previous.includes(actor))
    if (device.type === 'detector' && device.activated == null && !previous.length && occupants.length) {
      device.activated = state.round
      log(state, 'hunters', GEAR[device.type].unit + ' activated at ' + device.pos + '.', true)
    }
    if (isVideoDevice(device)) {
      for (const actor of entering) {
        const type = actor === state.cryptid.id ? (device.type === 'lowLight' ? 'clearVideo' : 'cryptidVideo') : 'animalVideo'
        event[actor] ??= actor === state.cryptid.id ? state.cryptid.presenceEvent : id()
        record(device, type, event[actor])
      }
    }
    device.occupants = occupants
  }
}

function behaviorFootage(state, source) {
  if (state.cryptid.disguise) return
  for (const device of localDevices(state, state.cryptid.pos)) {
    if (isVideoDevice(device)) record(device, 'behaviorVideo', source)
    if (device.type === 'mic') record(device, 'verifiedAudio', source)
  }
}

function investigateAlerts(state, hunter, pos) {
  const { spoofedAlarm } = state
  const devices = localDevices(state, pos).filter(item => item.type !== 'blockade' && item.activated != null)
  const snares = state.cryptidSnares.filter(item => item.pos === pos && item.discovered && item.activated != null)
  for (const item of [...devices, ...snares]) item.activated = null
  if (devices.length || snares.length) log(state, 'hunters', hunter.name + ' investigated equipment alerts at ' + pos + '.')
  const device = spoofedAlarm && state.devices.find(item => item.id === spoofedAlarm.id)
  if (device && device.type !== 'blockade' && spoofedAlarm.round + 1 === state.round && equipmentAt(device, pos) && !spoofedAlarm.investigated) {
    spoofedAlarm.investigated = true
    markCryptidGoal(state, 'decoy', spoofedAlarm.round, hunter.id)
    log(state, 'hunters', hunter.name + ' investigated the equipment alert at ' + pos + ' and found nothing.')
    log(state, 'cryptid', hunter.name + ' took the bait at ' + pos + '.')
  }
}

function inspectArrival(state, hunter) {
  triggerHunterSnare(state, hunter)
  const { pos } = hunter
  const { cryptid } = state
  if (pos === cryptid.pos && (pos === cryptid.lastSeen?.pos || cryptid.seen?.cameraId)) reveal(state)
  for (const animal of state.animals) {
    if (!animal.tagSignal?.scat || animal.tagSignal.pos !== hunter.pos) continue
    animal.tagged = false
    delete animal.tagSignal
    takePhoto(state, hunter, { id: id(), type: 'scat' })
    log(state, 'hunters', hunter.name + ' photographed scat at ' + hunter.pos + ' and found a broken tag.', true)
  }
  for (const clue of state.clues.filter(item => item.device && equipmentAt(item.device, hunter.pos) && !item.collected)) {
    discover(state, clue, true)
    if (!canPhotograph(hunter, clue)) continue
    const damageAge = state.round - clue.round
    takePhoto(state, hunter, clue, { brokenRound: clue.round })
    const age = damageAge === 0 ? 'this round' : damageAge + (damageAge === 1 ? ' round ago' : ' rounds ago')
    log(state, 'hunters', hunter.name + ' photographed a broken ' + GEAR[clue.device.type].unit.toLowerCase() +
      ' at ' + hunter.pos + '. It broke ' + age + '.', true)
  }
  for (const device of localDevices(state, hunter.pos)) {
    if ((isVideoDevice(device) || device.type === 'mic') && device.recordings.length) {
      retrieveRecordings(state, hunter, device)
    }
  }
}

function retrieveRecordings(state, hunter, device) {
  const tapes = device.recordings.splice(0)
  if (!tapes.length) return
  hunter.digital.push(...tapes)
  const confirmed = tapes.some(tape => ['cryptidVideo', 'clearVideo', 'behaviorVideo', 'verifiedAudio'].includes(tape.type))
  const quantity = tapes.length + (tapes.length === 1 ? ' recording' : ' recordings')
  log(state, 'hunters', hunter.name + ' retrieved ' + quantity + ' at ' + hunter.pos +
    (confirmed ? ' and confirmed Cryptid activity.' : '.'), confirmed)
}

function moveHunter(state, hunter, to) {
  hunter.pos = to
  refreshObservations(state)
  inspectArrival(state, hunter)
}

function rememberDevice(state, { id, type, pos, to }) {
  state.cryptid.memories[id] = { id, type, pos, to }
}

export function sensedEquipmentSectors(cryptid) {
  const here = MAP[cryptid.pos]
  if (cryptid.species !== 'Sasquatch') return [here.id]
  return Object.values(MAP).filter(sector => Math.abs(sector.x - here.x) <= 1 && Math.abs(sector.y - here.y) <= 1)
    .map(sector => sector.id)
}

function rememberEquipment(state, pos) {
  const { cryptid } = state
  for (const [key, memory] of Object.entries(cryptid.memories)) {
    if (equipmentAt(memory, pos)) delete cryptid.memories[key]
  }
  for (const device of localDevices(state, pos)) rememberDevice(state, device)
}

export function canCryptidTravel(state, from, to) {
  return !state.gas.has(to) && !hasBlockade(state.devices, from, to)
}

export function blockadeTargets(state, hunter) {
  if (!hunter.blockades) return []
  const equipment = hunterEquipment(state)
  return Object.values(MAP[hunter.pos].exits).filter(to => !hasBlockade(equipment, hunter.pos, to))
}

export const isMounted = hunter => hunter.hunterClass === 'biker' && hunter.bikePos === null
export const hunterMovementLimit = hunter => isMounted(hunter) ? RULES.mountedMovement : RULES.hunterMovement
export const hunterMovementLeft = hunter => hunter.ended || hunter.movementLost ? 0 : Math.max(0, hunterMovementLimit(hunter) - hunter.movementSpent)
export const canForage = cryptid => !cryptid.foraged && cryptid.hunger > 0 && ['w', 'p'].includes(MAP[cryptid.pos].type)

export function flyDestinations(state, distance = 2) {
  return Object.keys(DIRECTIONS).flatMap(dir => {
    const to = offsetSector(state.cryptid.pos, dir, distance)
    return to && !state.gas.has(to) ? [{ dir, to }] : []
  })
}

export const canMislead = cryptid => !cryptid.disguise && !['Mothman', 'Chupacabra'].includes(cryptid.species) && MAP[cryptid.pos].type !== 'r'

function moveAnimal(state, animal, to) {
  if (animal.pos === to) return
  const dir = Object.keys(MAP[animal.pos].exits).find(key => MAP[animal.pos].exits[key] === to)
  createClue(state, 'animalTracks', animal.pos, { dir, animalSpecies: animal.species })
  animal.pos = to
  triggerAnimalSnare(state, animal)
}

function endDisguise(state, surprised = false) {
  const { cryptid } = state
  const disguise = cryptid.disguise
  if (!disguise) return
  cryptid.tagged ||= disguise.tagged
  delete cryptid.disguise
  cryptid.presenceEvent = id()
  if (surprised || cryptid.tagged || state.hunters.some(hunter => hunter.pos === cryptid.pos)) reveal(state)
  log(state, 'cryptid', 'You returned to Mimic form.')
}

function moveCryptid(state, to, { flying = false, sneaking = false, event = id() } = {}) {
  const cryptid = state.cryptid
  const from = cryptid.pos
  const dir = Object.keys(MAP[from].exits).find(key => MAP[from].exits[key] === to)
  if (!cryptid.disguise && !flying && !sneaking && MAP[from].type !== 'r') createClue(state, 'tracks', from, { dir })
  if (!cryptid.disguise && !flying && cryptid.wounded && dir) createClue(state, 'blood', from, { dir })
  if (cryptid.seen) endSighting(state, cryptid.seen.cameraId ? from : to)
  cryptid.pos = to
  cryptid.presenceEvent = event
  if (cryptid.disguise) moveAnimal(state, cryptid.disguise, to)
  rememberEquipment(state, to)
  if (cryptid.tagged || state.hunters.some(hunter => hunter.pos === to)) reveal(state)
  triggerSnare(state, flying ? 'fly' : undefined)
}

function refreshObservations(state) {
  for (const animal of wildlifeOnMap(state)) {
    if (animal.observation?.live && (animal.status !== 'alive' ||
      animal.pos !== animal.observation.pos || (!animal.observation.camera && !state.hunters.some(hunter => hunter.pos === animal.pos)))) {
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
  if (state.cryptid.seen?.cameraId) endSighting(state, state.cryptid.pos)
  for (const animal of state.animals) {
    if (animal.observation?.camera) animal.observation.live = false
  }
  const { disguise } = state.cryptid
  if (disguise && state.round >= disguise.expiresAtDusk) endDisguise(state)
  else if (disguise?.snare) {
    alertWildlifeSnare(state, state.devices.find(device => device.id === disguise.snare))
  }
  state.spoofedAlarm = null
  for (const animal of state.animals.filter(animal => animal.status === 'alive')) {
    if (animal.snare) {
      const chance = SPECIES[animal.species].snareBreakChance
      if (chance && (chance === 1 || state.random() < chance)) releaseAnimalSnare(state, animal, true)
      else alertWildlifeSnare(state, state.devices.find(device => device.id === animal.snare))
      continue
    }
    const choices = wildlifeWeights(MAP[animal.pos], animal.species)
    let roll = state.random()
    const destination = (choices.find(choice => (roll -= choice.probability) < 0) ?? choices.at(-1)).pos
    if (destination === animal.pos) continue
    moveAnimal(state, animal, destination)
  }
  refreshObservations(state)
  updateDevices(state, {})
  state.phase = 'cryptid'
  state.cryptid.hunger = Math.min(RULES.maxHunger, state.cryptid.hunger + 1)
  const profile = CRYPTIDS[state.cryptid.species]
  state.cryptid.ap = profile.nightAP
  state.cryptid.movement = profile.nightMovement
  state.cryptid.movementLost = false
  state.cryptid.foraged = false
  log(state, 'hunters', 'Night falls. Wildlife has moved, and the Cryptid is taking its turn.')
  log(state, 'cryptid', 'Night falls. Hunger is ' + state.cryptid.hunger + '/' + RULES.maxHunger + '.')
}

function finishCryptidTurn(state) {
  const { cryptid } = state
  cryptid.ap = 0
  cryptid.movement = 0
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
    log(state, 'hunters', 'A starving Cryptid has given away its direction.', true)
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
  for (const sectors of state.searchedSectors.values()) sectors.clear()
  for (const hunter of state.hunters) {
    hunter.ap = RULES.actions - (cryptid.countyShriekRound === state.round - 1 ? 2 : Number(hunter.frightenedRound === state.round - 1))
    hunter.movementSpent = 0
    hunter.movementLost = false
    hunter.ended = false
  }
  log(state, 'hunters', 'Upkeep paid — $' + state.upkeep + '. Day begins.')
}

function usePack(hunter, type) {
  const index = hunter.gear.findIndex(pack => pack.type === type && pack.qty > 0)
  requireRule(index >= 0, 'You need ' + GEAR[type].name.toLowerCase() + '.')
  const pack = hunter.gear[index]
  pack.qty--
  if (!pack.qty && !['netgun', 'rifle'].includes(pack.type)) hunter.gear.splice(index, 1)
}

function addPack(packs, pack, maxSlots = Infinity) {
  // Check capacity before touching a partial pack. A failed transfer must be atomic.
  if (['netgun', 'rifle'].includes(pack.type)) {
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
    requireRule(camp && typeof target === 'string' && gearAvailable(target, state.faction), 'This item is not available to buy at camp.')
    const definition = GEAR[target]
    const price = shopPrice(hunter, target)
    requireRule(state.cash >= price, 'The expedition cannot afford this pack.')
    if (triggerHunterSnare(state, hunter)) return
    addPack(site.gear, { id: id(), type: target, qty: definition.size })
    state.cash -= price
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
    if (evidence && state.faction === 'fans') {
      for (const item of items) {
        const proof = EVIDENCE[item.type].proof
        if (proof && (proof === 'visual' || !state.proof.has(item.source))) state.proof.set(item.source, proof)
      }
      if (state.proof.size >= 2 && [...state.proof.values()].includes('visual')) state.winner = 'hunters'
    }
    log(state, 'hunters', hunter.name + (evidence ? ' submitted evidence' : ' sold meat') + ' for $' + amount + '.')
    if (evidence && items.some(item => item.photo && item.type === 'sighting')) {
      state.cryptid.photoIdentified = true
      log(state, 'hunters', 'Submitted Cryptid photograph identified the species as ' + state.cryptid.species + '.')
    }
  } else if (type === 'storeCargo' || type === 'takeCargo') {
    const storing = type === 'storeCargo'
    const from = storing ? hunter.cargo : site.cargo
    const to = storing ? site.cargo : hunter.cargo
    const index = from.findIndex(item => item.id === target && item.species)
    requireRule(index >= 0, 'That carcass is no longer available.')
    requireRule(storing || to.length < cargoCapacity(hunter), 'No free cargo slot.')
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
  for (const animal of living(state, origin).filter(item => item !== state.cryptid.disguise)) {
    if (!exits.length) continue
    releaseAnimalSnare(state, animal, true)
    moveAnimal(state, animal, pick(exits, state.random))
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
    return
  }
  const interrupted = () => triggerHunterSnare(state, hunter)
  if (type === 'toggleBike') {
    requireRule(hunter.hunterClass === 'biker', 'Only the Field Mobility Specialist can ride off-road.')
    requireRule(hunter.ap >= 1, 'Mounting or dismounting the bike costs 1 AP.')
    const mounted = isMounted(hunter)
    if (!mounted) {
      requireRule(!hunter.restraint, 'Escape the snare before mounting.')
      requireRule(hunter.bikePos === hunter.pos, 'Return to the parked bike before mounting it.')
      if (interrupted()) return
    }
    hunter.bikePos = mounted ? hunter.pos : null
    hunter.ap--
    if (mounted) triggerHunterSnare(state, hunter)
    return
  }
  requireRule(!isMounted(hunter) || type === 'move', 'Dismount the bike before taking actions.')
  if (type === 'escape') {
    requireRule(hunter.restraint && hunter.ap >= RULES.escapeAP, 'Escaping a snare requires 2 AP.')
    breakHunterRestraint(state, hunter)
    hunter.ap -= RULES.escapeAP
    log(state, 'hunters', hunter.name + ' escaped a Cryptid snare.')
    return
  }
  requireRule(!hunter.restraint, 'Escape the snare before acting.')
  if (siteActions.has(type)) {
    interactWithSite(state, hunter, command)
    if (!state.winner && state.cash === 0) state.winner = 'cryptid'
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
  const pos = hunter.pos
  if (type === 'move') {
    requireRule(hunterMovementLeft(hunter) > 0, 'You have no movement left today.')
    requireRule(Object.values(MAP[pos].exits).includes(target), 'There is no route to that space.')
    moveHunter(state, hunter, target)
    hunter.movementSpent++
    return
  }
  const cost = type === 'deploy' ? deployCost(state, hunter, target) :
    (type === 'checkCamera' ? RULES.cameraSearchAP : type === 'capture' ? 2 : type === 'fireRifle' ? rifleCost(state, hunter) :
      type === 'search' ? RULES.searchAP : type === 'photo' ? photoCost(state, hunter, state.clues.find(clue => clue.id === target)?.type) : type === 'gas' ? gasCost(state, hunter) : 1)
  requireRule(hunter.ap >= cost, 'You do not have enough AP for that action.')
  const { cryptid } = state
  let searchFindings
  switch (type) {
    case 'blockade': {
      requireRule(blockadeTargets(state, hunter).includes(target), 'A blockade specialist with a spare blockade can close a connected trail.')
      if (interrupted()) return
      const blockade = { id: id(), type: 'blockade', pos, to: target, cargo: [] }
      state.devices.push(blockade)
      hunter.blockades--
      if (equipmentAt(blockade, cryptid.pos)) rememberDevice(state, blockade)
      log(state, 'hunters', hunter.name + ' blocked the trail between ' + pos + ' and ' + target + '.')
      break
    }
    case 'search':
    case 'checkCamera': {
      const camera = type === 'checkCamera' ? state.devices.find(item => item.id === target && isVideoDevice(item) && item.owner === hunter.id) : null
      requireRule(type !== 'checkCamera' || camera, 'Only the researcher who deployed a working camera can check its feed.')
      const sector = camera?.pos ?? pos
      requireRule(!hasSearchedHere(state, hunter, sector), 'You already searched this sector today.')
      if (interrupted()) return
      if (camera) camera.checkedVersion = camera.recordingVersion ?? 0
      searchHistory(state, hunter).add(sector)
      investigateAlerts(state, hunter, sector)
      const animals = living(state, sector)
      for (const animal of animals) animal.observation = { pos: sector, round: state.round, live: true, ...(camera ? { camera: camera.id } : {}) }
      const carcasses = state.animals.filter(item => item.status === 'ground' && item.pos === sector)
      for (const animal of carcasses) animal.groundFound = true
      const clues = state.clues.filter(clue => clue.pos === sector && !clue.collected && isLive(state, clue) &&
        (!clue.device || clue.discovery) &&
        (clue.type !== 'sighting' || clue === cryptid.seen))
      for (const clue of clues) discover(state, clue, hasPack(hunter, 'kit') || HUNTER_CLASSES[hunter.hunterClass]?.exactTracks ||
        (clue.type === 'blood' && hasPack(hunter, 'bloodKit')))
      if (cryptid.pos === sector) {
        const sighting = reveal(state, camera?.id)
        if (sighting && !clues.includes(sighting)) clues.push(sighting)
      }
      const photos = clues.filter(clue => EVIDENCE[clue.type].price > 0 && canPhotograph(hunter, clue))
      for (const clue of photos) takePhoto(state, hunter, clue, { paid: cost > 0 })
      log(state, 'hunters', hunter.name + ' searched ' + sector + (camera ? ' by camera' : '') + ' and found ' + animals.length + ' wildlife and ' + clues.length + ' clues.' +
        (photos.length ? ' Photos saved: ' + photos.length + '.' : ''))
      searchFindings = { sector, clueIds: clues.map(clue => clue.id),
        wildlife: [...animals, ...carcasses].map(({ species, status, snare }) => ({ species, status, snared: Boolean(snare) })),
      }
      break
    }
    case 'shoot':
      requireRule(cryptid.pos === pos && cryptid.seen, 'Confirm the Cryptid in your space first.')
      requireRule(state.faction === 'researchers' && cryptid.species === 'Sasquatch', 'This launcher can only restrain Sasquatch.')
      requireRule(!cryptid.restraint, 'The Cryptid is already restrained.')
      requireRule(hasPack(hunter, 'netgun'), 'You need a loaded netgun.')
      if (interrupted()) return
      usePack(hunter, 'netgun')
      cryptid.restraint = { device: null }
      log(state, 'hunters', hunter.name + ' netted the Cryptid at ' + pos + '.', true)
      break
    case 'capture':
      requireRule(state.faction === 'researchers', 'Only Researchers can capture the Cryptid.')
      requireRule(cryptid.pos === pos && cryptid.seen && cryptid.restraint, 'Capture requires a confirmed, restrained Cryptid in your space.')
      if (interrupted()) return
      state.winner = 'hunters'
      log(state, 'hunters', hunter.name + ' captured the Cryptid at ' + pos + '.')
      log(state, 'cryptid', 'You were captured at ' + pos + '.')
      break
    case 'range':
      requireRule(state.faction === 'hunters' && hasPack(hunter, 'rangefinder') && cryptid.pos === pos && cryptid.seen,
        'Rangefinding requires a confirmed Cryptid and a rangefinder in this sector.')
      requireRule(state.rangeMark?.round !== state.round || state.rangeMark.pos !== pos, 'This target is already ranged.')
      if (interrupted()) return
      state.rangeMark = { round: state.round, pos }
      break
    case 'fireRifle':
      requireRule(state.faction === 'hunters' && hasPack(hunter, 'rifle') && cryptid.pos === pos && cryptid.seen,
        'A loaded rifle and confirmed Cryptid in this sector are required.')
      requireRule(hunter.shotRound !== state.round, 'This researcher already fired today.')
      if (interrupted()) return
      usePack(hunter, 'rifle')
      hunter.shotRound = state.round
      state.rangeMark = null
      if (cryptid.wounded) {
        state.winner = 'hunters'
        log(state, 'hunters', hunter.name + ' landed the finishing shot.')
      } else {
        cryptid.wounded = true
        log(state, 'hunters', hunter.name + ' wounded the confirmed Cryptid at ' + pos + '.')
        log(state, 'cryptid', 'You were wounded. Ground movement leaves a blood trail.')
      }
      break
    case 'deploy':
      requireRule(known(GEAR, target) && GEAR[target].deploy, 'Select deployable equipment.')
      requireRule(hasPack(hunter, target), 'You need ' + GEAR[target].name.toLowerCase() + '.')
      if (interrupted()) return
      usePack(hunter, target)
      if (!cost) hunter.freeDeployRound = state.round
      state.devices.push({
        id: id(), type: target, pos, owner: hunter.id, occupants: [], activated: null, recordings: [], gear: [], cargo: [],
      })
      if (target === 'snare') {
        for (const animal of living(state, pos)) triggerAnimalSnare(state, animal)
      }
      updateDevices(state, {})
      log(state, 'hunters', hunter.name + ' deployed a ' + GEAR[target].unit.toLowerCase() + ' at ' + pos + '.')
      break
    case 'recover': {
      const device = localDevices(state, pos).find(item => item.id === target)
      requireRule(device && !occupiedSnare(state, device), 'That device cannot be recovered.')
      requireRule(!GEAR[device.type].classGear || HUNTER_CLASSES[hunter.hunterClass]?.blockades, 'Only a trail blockade specialist can recover a blockade.')
      requireRule(device.type !== 'tent' || (!device.gear.length && !device.cargo.length), 'Empty the tent cache first.')
      if (interrupted()) return
      if (device.type === 'blockade') {
        hunter.blockades++
        if (equipmentAt(device, cryptid.pos)) delete cryptid.memories[device.id]
        log(state, 'hunters', hunter.name + ' recovered the blockade on ' + device.pos + '–' + device.to + '.')
      } else {
        addPack(hunter.gear, { id: id(), type: device.type, qty: 1 }, equipmentCapacity(hunter))
        retrieveRecordings(state, hunter, device)
      }
      removeDevice(state, device)
      break
    }
    case 'hunt':
    case 'tag': {
      const animal = localAnimals(state, pos).find(item => item.id === target)
      requireRule(animal, 'Search for that animal in your space first.')
      if (type === 'tag') {
        requireRule(state.faction === 'researchers' && animal.snare, 'Only Researchers can tag live snared wildlife.')
        requireRule(!animal.tagged, 'This animal already has a tag.')
        requireRule(hasPack(hunter, 'tag'), 'You need animal tags.')
        if (interrupted()) return
        usePack(hunter, 'tag')
        animal.tagged = true
      } else {
        requireRule(state.faction === 'hunters', 'Only Hunters can hunt wildlife.')
        requireRule(animal.snare || hasPack(hunter, 'rifle'), 'Hunting free wildlife requires a loaded rifle.')
        if (animal === cryptid.disguise) {
          if (interrupted()) return
          const fired = hasPack(hunter, 'rifle')
          if (fired) usePack(hunter, 'rifle')
          endDisguise(state, true)
          updateDevices(state, {})
          log(state, 'hunters', hunter.name + ' uncovered the Mimic' + (fired ? ' and ended their turn in surprise.' : '.'))
          hunter.ap -= cost
          if (fired) hunter.ended = true
          return
        }
        requireRule(hunter.cargo.length < cargoCapacity(hunter), 'No free cargo slot.')
        if (interrupted()) return
        if (!animal.snare) usePack(hunter, 'rifle')
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
      requireRule(hunter.cargo.length < cargoCapacity(hunter), 'No free cargo slot.')
      if (interrupted()) return
      animal.status = 'carried'
      animal.owner = hunter.id
      hunter.cargo.push(animal)
      break
    }
    case 'photo':
    case 'preserve':
    case 'collect': {
      const clue = localClues(state, pos).find(item => item.id === target &&
        (item.type !== 'sighting' || item === cryptid.seen))
      requireRule(clue, 'That evidence is no longer available in your space.')
      if (type === 'photo') {
        requireRule(EVIDENCE[clue.type].price > 0, 'Wildlife tracks are scouting information and cannot be submitted.')
        requireRule(canPhotograph(hunter, clue), 'This evidence has already been photographed.')
        if (interrupted()) return
        takePhoto(state, hunter, clue, { paid: cost > 0 })
        if (!cost) hunter.freePhotoRound = state.round
      } else {
        const preserving = type === 'preserve'
        requireRule(!preserving || (state.faction === 'fans' && clue.type === 'feed' && hasPack(hunter, 'sampleKit')),
          'A sealed sample kit and discovered Cryptid feeding remains are required.')
        requireRule(EVIDENCE[clue.type].collectible, 'This clue is not a collectible sample.')
        requireRule(hunter.cargo.length < cargoCapacity(hunter), 'No free cargo slot.')
        if (interrupted()) return
        clue.collected = true
        if (preserving) usePack(hunter, 'sampleKit')
        hunter.cargo.push({ id: id(), type: preserving ? 'verifiedSample' : clue.type, source: clue.id })
      }
      break
    }
    case 'gas':
      requireRule(hasPack(hunter, 'gas'), 'You need tear gas.')
      if (interrupted()) return
      usePack(hunter, 'gas')
      if (!cost) hunter.freeGasRound = state.round
      useGas(state, pos)
      log(state, 'hunters', 'Tear gas deployed at ' + pos + '.')
      break
    case 'reload': {
      const gun = hunter.gear.find(item => item.id === target && ['netgun', 'rifle'].includes(item.type))
      const ammo = hunter.gear.find(item => item.type === (gun?.type === 'rifle' ? 'rifleAmmo' : 'ammo'))
      requireRule(gun && ammo && gun.qty < GEAR[gun.type].size, 'You need a tool with room and compatible ammunition.')
      if (interrupted()) return
      const shots = Math.min(ammo.qty, GEAR[gun.type].size - gun.qty)
      gun.qty += shots
      ammo.qty -= shots
      if (!ammo.qty) hunter.gear = hunter.gear.filter(item => item !== ammo)
      break
    }
    default:
      throw new RuleError('Unknown hunter action.')
  }
  hunter.ap -= cost
  return searchFindings
}

export function shriekTargets(state) {
  const { pos } = state.cryptid
  const nearby = [pos, ...Object.values(MAP[pos].exits)]
  return state.hunters.filter(hunter => nearby.includes(hunter.pos) && hunter.frightenedRound !== state.round)
}

export function lureTargets(state) {
  const { pos } = state.cryptid
  const nearby = Object.values(MAP[pos].exits)
  return state.animals.filter(animal => animal.status === 'alive' && !animal.snare &&
    nearby.includes(animal.pos) && SPECIES[animal.species].allowed.includes(MAP[pos].type))
}

function flyCryptid(state, target, distance) {
  const { cryptid } = state
  requireRule(!cryptid.movementLost, 'You lost your movement for the rest of this turn.')
  const destination = flyDestinations(state, distance).find(({ dir }) => dir === target)
  requireRule(destination, 'Choose an open landing sector outside tear gas.')
  const flight = id()
  behaviorFootage(state, flight)
  moveCryptid(state, destination.to, { flying: true, event: flight })
  updateDevices(state, { [cryptid.id]: flight })
  const landing = MAP[destination.to]
  if (landing.name !== landing.terrain) markCryptidGoal(state, 'landmark', destination.to)
  log(state, 'cryptid', 'You flew ' + directionNames[destination.dir] + ' to ' + destination.to + '.')
}

export function phantomTargets(state) {
  const origin = MAP[state.cryptid.pos]
  const isRemote = pos => {
    const sector = MAP[pos]
    return Math.max(Math.abs(origin.x - sector.x), Math.abs(origin.y - sector.y)) > 1
  }
  return state.devices.filter(device => device.type !== 'blockade' && isRemote(device.pos) && (!device.to || isRemote(device.to)))
}

function useUltimate(state, target) {
  const { cryptid } = state
  requireRule(cryptid.ultimateUnlocked, 'Your ultimate is locked.')
  requireRule(!ultimateCooldown(state), 'Your ultimate is on cooldown.')
  if (cryptid.species === 'Mimic') requireRule(known(SPECIES, target), 'Choose a wildlife species to imitate.')
  if (cryptid.species === 'Mothman') flyCryptid(state, target, 4)
  else {
    if (triggerSnare(state, cryptid.species === 'Jersey Devil' ? 'shriek' : undefined)) return false
    behaviorFootage(state, id())
    if (cryptid.species === 'Sasquatch') {
      const sectors = sensedEquipmentSectors(cryptid)
      for (const device of state.devices.filter(item => canDestroyEquipment(item) && sectors.some(pos => equipmentAt(item, pos)))) breakDevice(state, device, true)
    } else if (cryptid.species === 'Jersey Devil') {
      cryptid.countyShriekRound = state.round
      log(state, 'hunters', 'A countywide shriek left the expedition shaken. Everyone starts next Day with 1 AP.')
    } else if (cryptid.species === 'Chupacabra') {
      cryptid.hunger = 0
      if (!cryptid.movementLost) cryptid.movement += 3
    } else if (cryptid.species === 'Mimic') {
      if (cryptid.seen) endSighting(state, cryptid.pos)
      cryptid.disguise = { id: id(), species: target, pos: cryptid.pos, status: 'alive', observation: null,
        expiresAtDusk: state.round + RULES.mimicFormDuration }
      triggerAnimalSnare(state, cryptid.disguise)
      updateDevices(state, {})
    }
  }
  cryptid.ultimateReadyRound = state.round + RULES.ultimateCooldown + 1
  log(state, 'cryptid', 'You used ' + CRYPTIDS[cryptid.species].ultimate.name + '.')
  return true
}

function useAbility(state, target) {
  const { cryptid } = state
  const { species, pos } = cryptid
  if (species === 'Mothman') {
    flyCryptid(state, target, 2)
  } else if (species === 'Jersey Devil') {
    const targets = shriekTargets(state)
    requireRule(targets.length, 'There is nobody close enough to frighten this Night.')
    if (triggerSnare(state, 'shriek')) return false
    behaviorFootage(state, id())
    for (const hunter of targets) {
      hunter.frightenedRound = state.round
      markCryptidGoal(state, 'frighten', state.round + ':' + hunter.id)
      log(state, 'hunters', hunter.name + ' was frightened by a shriek and will start next Day with 2 AP.')
    }
    log(state, 'cryptid', 'Your shriek frightened ' + targets.length + ' expedition members.')
  } else if (species === 'Chupacabra') {
    const animal = lureTargets(state).find(item => item.id === target)
    requireRule(animal, 'Choose a free animal in a connected sector with suitable habitat here.')
    behaviorFootage(state, id())
    moveAnimal(state, animal, pos)
    refreshObservations(state)
    updateDevices(state, {})
    log(state, 'cryptid', 'You lured a ' + SPECIES[animal.species].name.toLowerCase() + ' into ' + pos + '.')
  } else if (species === 'Mimic') {
    const remote = phantomTargets(state)
    requireRule(remote.length, 'Phantom Trigger needs deployed equipment more than one sector away.')
    if (triggerSnare(state, 'radio')) return false
    behaviorFootage(state, id())
    const device = pick(remote, state.random)
    state.spoofedAlarm = { id: device.id, round: state.round }
    log(state, 'hunters', GEAR[device.type].unit + ' activated at ' + device.pos + '.', true)
    log(state, 'cryptid', 'You spoofed an equipment alert at ' + device.pos + '.')
  }
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
  const pos = cryptid.pos
  requireRule(type !== 'ability' || !CRYPTIDS[cryptid.species].passive, 'Sasquatch senses equipment automatically.')
  const profile = CRYPTIDS[cryptid.species]
  const cost = type === 'ability' ? profile.abilityCost : type === 'ultimate' ? profile.nightAP :
    type === 'escape' ? RULES.escapeAP : (CRYPTID_ACTION_COST[type] ?? 1)
  if (type === 'move' || type === 'sneak') {
    requireRule(type !== 'sneak' || cryptid.ap >= cost, 'Sneaking requires 2 AP.')
    const movementCost = type === 'sneak' ? SNEAK_MOVEMENT_COST : 1
    requireRule(cryptid.movement >= movementCost, type === 'sneak' ? 'Sneaking requires 2 movement.' : 'You have no movement left tonight.')
    requireRule(!cryptid.restraint, 'Escape the restraint before moving.')
    requireRule(Object.values(MAP[pos].exits).includes(target) && canCryptidTravel(state, pos, target), 'There is no legal route to that space.')
    cryptid.movement -= movementCost
    moveCryptid(state, target, { sneaking: type === 'sneak' })
    updateDevices(state, {})
    if (type === 'sneak') {
      cryptid.ap -= cost
      log(state, 'cryptid', 'You sneaked to ' + target + ' without leaving footprints.')
    }
    return
  }
  requireRule(cryptid.ap >= cost, 'You do not have enough AP for that action.')
  if (type === 'escape') {
    requireRule(cryptid.restraint, 'You are not restrained.')
    breakRestraint(state)
    log(state, 'cryptid', 'You escaped the restraint.')
  } else {
    requireRule(!cryptid.restraint, 'Escape the restraint before acting.')
    if (type === 'ultimate') {
      if (!useUltimate(state, target)) return
    } else if (type === 'setSnare') {
      requireRule(cryptid.snareRound !== state.round, 'You can set one snare each Night.')
      requireRule(!state.cryptidSnares.some(snare => snare.pos === pos), 'There is already a Cryptid snare in this sector.')
      if (triggerSnare(state)) return
      cryptid.snareRound = state.round
      state.cryptidSnares.push({ id: id(), pos, discovered: false, activated: null })
      behaviorFootage(state, id())
      log(state, 'cryptid', 'You set a hidden snare at ' + pos + '.')
    } else if (type === 'forage') {
      requireRule(canForage(cryptid), 'Forage once per night in woodland or pine forest while hungry.')
      if (triggerSnare(state)) return
      cryptid.foraged = true
      const foundFood = state.random() < RULES.forageChance
      if (foundFood) cryptid.hunger--
      behaviorFootage(state, id())
      log(state, 'cryptid', foundFood ? 'You foraged and reduced your hunger by one.' : 'You foraged but found no food.')
    } else if (type === 'flush') {
      requireRule(Object.values(MAP[pos].exits).includes(target), 'Choose a connected sector to flush wildlife into.')
      const animals = living(state, pos).filter(animal => !animal.snare && animal !== cryptid.disguise)
      requireRule(animals.length > 0, 'There is no free wildlife in this sector to flush.')
      if (triggerSnare(state)) return
      for (const animal of animals) {
        moveAnimal(state, animal, target)
      }
      refreshObservations(state)
      behaviorFootage(state, id())
      updateDevices(state, {})
      log(state, 'cryptid', 'You flushed wildlife toward ' + target + '.')
    } else if (type === 'ability') {
      requireRule(known(CRYPTIDS, cryptid.species), 'This Cryptid has no special ability.')
      if (!useAbility(state, target)) return
    } else if (type === 'feed') {
      const animal = state.animals.find(item => item.id === target && item.pos === pos &&
        (item.status === 'alive' || item.status === 'ground'))
      requireRule(animal, 'There is no such food in this space.')
      if (triggerSnare(state, 'feed')) return
      releaseAnimalSnare(state, animal)
      if (animal.tagged) {
        animal.tagSignal = {
          pos, status: animal.status,
          followThrough: state.random() < RULES.tagRemainsChance ? null : state.round + 1,
        }
        animal.observation = null
      }
      animal.status = 'consumed'
      markCryptidGoal(state, 'feed', animal.id, animal.species)
      if (animal.observation) animal.observation.live = false
      cryptid.hunger = Math.max(0, cryptid.hunger - SPECIES[animal.species].food)
      const clue = createClue(state, 'feed', pos)
      behaviorFootage(state, clue.id)
      updateDevices(state, {})
      log(state, 'cryptid', 'You fed on a ' + SPECIES[animal.species].name.toLowerCase() + '.')
    } else if (type === 'destroy') {
      const device = localDevices(state, pos).find(item => item.id === target && cryptid.memories[item.id])
      requireRule(device && canDestroyEquipment(device), 'That equipment cannot be destroyed.')
      if (triggerSnare(state)) return
      breakDevice(state, device, true)
      markCryptidGoal(state, 'sabotage', device.id, pos)
      log(state, 'cryptid', 'You destroyed a ' + GEAR[device.type].unit.toLowerCase() + '.')
    } else if (type === 'mislead') {
      requireRule(canMislead(cryptid) && known(MAP[pos].exits, target), 'This Cryptid cannot leave false tracks here.')
      if (triggerSnare(state)) return
      const clue = createClue(state, 'tracks', pos, { dir: target, falseTrail: true })
      behaviorFootage(state, clue.id)
      log(state, 'cryptid', 'You left false tracks heading ' + directionNames[target] + '.')
    } else {
      throw new RuleError('Unknown Cryptid action.')
    }
  }
  cryptid.ap -= cost
}

export function act(state, actor, command) {
  requireRule(!state.winner, 'The expedition has ended.')
  requireRule(command && typeof command.type === 'string', 'Choose an action.')
  const hunter = state.hunters.find(member => member.id === (command.hunterId ?? actor) &&
    (member.ownerId ?? member.id) === actor)
  let searchFindings
  if (hunter) {
    searchFindings = hunterAction(state, hunter, command)
    if (!state.winner) {
      if (hunter.ap === 0 && hunterMovementLeft(hunter) === 0) hunter.ended = true
      if (state.hunters.every(member => member.ended)) advanceWildlife(state)
    }
  } else {
    requireRule(command.hunterId == null, 'You do not control that researcher.')
    requireRule(state.cryptid.id === actor, 'You do not have a seat in this match.')
    cryptidAction(state, command)
  }
  const { cryptid } = state
  if (cryptid.species === 'Sasquatch') {
    for (const pos of sensedEquipmentSectors(cryptid)) rememberEquipment(state, pos)
  }
  const goal = cryptidGoal(state)
  if (!state.winner && !cryptid.ultimateUnlocked && goal.progress >= goal.target &&
    goal.requirements.every(item => item.progress >= item.target)) {
    cryptid.ultimateUnlocked = true
    log(state, 'cryptid', 'Personal challenge complete. Your ultimate is now available.')
  }
  return searchFindings
}
