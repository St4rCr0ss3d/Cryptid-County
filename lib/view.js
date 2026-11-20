import { CAMP, MAP, GEAR, EVIDENCE, SPECIES, RULES, CRYPTIDS, HUNTER_CLASSES, directionNames } from './config.js'
import { assessEvidence, bikeRoutes, blockadeTargets, canCryptidTravel, equipmentAt, equipmentCapacity, flyDestinations, hasFreeSnarePlacement, hunterEquipment } from './game.js'

const gear = packs => packs.map(({ id, type, qty }) => ({ id, type, qty }))
const evidence = ({ id, type }) => ({ id, type, name: EVIDENCE[type].name })
const cargo = item => item.species
  ? { id: item.id, species: item.species, name: SPECIES[item.species].name + ' carcass' }
  : evidence(item)

function clueView(state, clue, hunter) {
  const age = state.round - clue.round
  const expired = age >= (clue.type === 'tracks' ? RULES.footprintLife : RULES.otherClueLife)
  const date = clue.discovery.exact ? age + (age === 1 ? ' round ago' : ' rounds ago') : (age <= RULES.freshThrough ? 'Fresh' : 'Cold')
  const label = hunter.hunterClass === 'believer' && clue.falseTrail ? 'False tracks' : EVIDENCE[clue.type].name
  const name = label + (clue.dir ? ' heading ' + directionNames[clue.dir] : '')
  return { id: clue.id, type: clue.type, name, date, pos: clue.pos, expired,
    collected: Boolean(clue.collected), discovered: clue.discovery.round }
}

function animalPosition(state, animal) {
  if (animal.status === 'carried') return state.hunters.find(hunter => hunter.id === animal.owner).pos
  return animal.pos
}

function hunterAnimals(state) {
  return state.animals.flatMap(animal => {
    const { id, species, tagged, observation, status, tagSignal } = animal
    const name = SPECIES[species].name
    if (tagged && status !== 'sold') {
      const pos = tagSignal ? (tagSignal.followThrough == null ? tagSignal.pos : state.cryptid.pos) : animalPosition(state, animal)
      return [{ id, name, species, pos, tagged, status: tagSignal?.status ?? status, live: true }]
    }
    if (tagged) return []
    if (status === 'ground' && animal.groundFound) return [{ id, name, species, pos: animal.pos, status, live: true }]
    if (!observation) return []
    return [{ id, name, species, pos: observation.pos, status: 'alive', tagged, live: observation.live }]
  })
}

const action = (type, label, target, extra = {}) => ({ type, label, target, ...extra })

function hunterView(state, hunter, shared) {
  const { cryptid } = state
  const equipment = hunterEquipment(state)
  const local = equipment.filter(device => equipmentAt(device, hunter.pos))
  const sites = local.filter(device => device.type === 'tent')
  if (hunter.pos === CAMP) sites.unshift(state.cache)
  const clues = state.clues.filter(clue => clue.discovery)
  const animals = hunterAnimals(state)
  const cryptidHere = cryptid.seen && cryptid.pos === hunter.pos
  const ready = state.phase === 'hunters' && !hunter.ended && !state.winner
  const canAct = ready && hunter.ap > 0 && !hunter.restraint
  const capacity = equipmentCapacity(hunter)
  const has = type => hunter.gear.some(pack => pack.type === type && pack.qty > 0)
  const freeSnare = ready && !hunter.restraint && has('snare') && hasFreeSnarePlacement(state, hunter)
  const cargoRoom = hunter.cargo.length < RULES.cargo
  const actions = []
  if (ready && hunter.ap && hunter.restraint) actions.push(action('escape', 'Escape Cryptid snare'))
  if (canAct) {
    actions.push(action('search', 'Search this space'))
    if (cryptidHere) {
      if (cryptid.restraint) actions.push(action('capture', 'Capture Cryptid'))
      else if (has('netgun')) actions.push(action('shoot', 'Fire netgun'))
    }
    for (const animal of animals.filter(item => item.live && item.pos === hunter.pos)) {
      if (!state.animals.some(item => item.id === animal.id && item.pos === hunter.pos && item.status === animal.status)) continue
      if (animal.status === 'alive') {
        if (cargoRoom) actions.push(action('hunt', 'Hunt ' + animal.name, animal.id))
        if (has('tag') && !animal.tagged) actions.push(action('tag', 'Tag ' + animal.name, animal.id))
      }
      if (animal.status === 'ground' && cargoRoom) actions.push(action('takeGround', 'Pick up ' + animal.name + ' carcass', animal.id))
    }
    for (const clue of clues.filter(item => item.pos === hunter.pos && !item.collected &&
      !clueView(state, item, hunter).expired && (item.type !== 'sighting' || item === cryptid.seen))) {
      if (!clue.photographers?.includes(hunter.id)) actions.push(action('photo', 'Photograph ' + clueView(state, clue, hunter).name.toLowerCase(), clue.id))
      if (EVIDENCE[clue.type].collectible && cargoRoom) actions.push(action('collect', 'Collect ' + EVIDENCE[clue.type].name.toLowerCase(), clue.id))
    }
    for (const [type, definition] of Object.entries(GEAR)) {
      if (type === 'snare' && freeSnare) continue
      if (definition.deploy && has(type)) actions.push(action('deploy', 'Deploy ' + definition.unit.toLowerCase(), type))
    }
    for (const device of local) {
      if (device.type === 'blockade') {
        if (hunter.hunterClass === 'ranger') actions.push(action('recover', 'Recover blockade · ' + device.pos + '–' + device.to, device.id))
        continue
      }
      const canFit = hunter.gear.length < capacity || hunter.gear.some(pack =>
        pack.type === device.type && pack.qty < GEAR[pack.type].size)
      if (canFit && !(device.type === 'snare' && device.activated != null) &&
          (device.type !== 'tent' || (!device.gear.length && !device.cargo.length))) {
        actions.push(action('recover', 'Recover ' + GEAR[device.type].unit.toLowerCase(), device.id))
      }
    }
    if (has('gas')) actions.push(action('gas', 'Use tear gas'))
    for (const pack of hunter.gear) {
      if (pack.type === 'netgun' && pack.qty < GEAR.netgun.size && has('ammo')) actions.push(action('reload', 'Reload netgun', pack.id))
    }
  }
  if (freeSnare) actions.push(action('deploy', 'Deploy snare · 0 AP', 'snare'))
  if (ready && !hunter.restraint) {
    for (const item of hunter.cargo.filter(item => item.species)) {
      actions.push(action('dropCargo', 'Drop ' + SPECIES[item.species].name + ' carcass · 0 AP', item.id))
    }
  }
  const warning = state.warnings[hunter.id]
  const warnings = state.hunters.flatMap(member => state.warnings[member.id]
    ? [{ name: member.name, ...state.warnings[member.id] }] : [])
  const assessment = assessEvidence(state, hunter)
  const damage = clues.filter(clue => clue.device && !clue.collected).map(({ device }) => ({
    id: device.id, type: device.type, pos: device.pos, to: device.to, broken: true,
  }))
  return {
    ...shared, role: 'hunter', player: {
      ...shared.player, gear: gear(hunter.gear),
      cargo: hunter.cargo.map(item => item.species ? cargo(item) : { ...evidence(item), value: assessment.get(item.id) }),
      hunterClass: hunter.hunterClass, className: HUNTER_CLASSES[hunter.hunterClass]?.name,
      equipmentCapacity: capacity, blockades: hunter.blockades,
      digital: hunter.digital.map(item => ({
        ...evidence(item), photo: Boolean(item.photo), video: Boolean(EVIDENCE[item.type].video),
        value: assessment.get(item.id), damageAge: item.brokenRound == null ? undefined : state.round - item.brokenRound,
      })),
      restrained: Boolean(hunter.restraint), ended: hunter.ended,
    },
    cash: state.cash, upkeep: state.upkeep, clues: clues.map(clue => clueView(state, clue, hunter)).reverse(), animals,
    cryptid: cryptid.seen ? { pos: cryptid.pos, live: true, restrained: Boolean(cryptid.restraint), name: cryptid.species }
      : cryptid.lastSeen ? { ...cryptid.lastSeen, live: false, name: cryptid.species } : null,
    devices: [...equipment.map(({ id, type, pos, to, activated }) => ({ id, type, pos, ...(to ? { to } : {}), activated })), ...damage],
    snares: state.cryptidSnares.filter(snare => snare.discovered).map(({ pos, activated }) => ({ pos, activated })),
    sites: sites.map(site => ({ id: site.id, name: site.id === CAMP ? 'Base camp' : 'Tent cache',
      camp: site.id === CAMP, gear: gear(site.gear), cargo: site.cargo.map(cargo) })),
    warning, warnings, actions, ready, canEnd: ready, logs: state.logs.hunters,
    blockadeTargets: canAct ? blockadeTargets(state, hunter) : [],
    bikeMoves: canAct ? bikeRoutes(hunter).map(route => route.to) : [],
    moves: canAct ? Object.values(MAP[hunter.pos].exits) : [],
  }
}

function cryptidView(state, shared) {
  const { cryptid } = state
  const { pos } = cryptid
  const ability = CRYPTIDS[cryptid.species]
  const ready = state.phase === 'cryptid' && !state.winner
  const foods = state.animals.filter(animal => animal.pos === pos &&
    (animal.status === 'alive' || animal.status === 'ground'))
  const actions = []
  if (ready && cryptid.ap) {
    if (cryptid.restraint) actions.push(action('escape', 'Escape restraint'))
    else {
      for (const animal of foods) actions.push(action('feed', 'Feed on ' + SPECIES[animal.species].name, animal.id))
      for (const growth of state.chargeGrowths.filter(item => item.pos === pos)) {
        actions.push(action('feedGrowth', 'Feed on charge growth', growth.id))
      }
      if (cryptid.charges && ability) {
        if (cryptid.species === 'Mothman') {
          for (const { dir, to } of flyDestinations(state)) {
            actions.push(action('ability', 'Fly ' + directionNames[dir] + ' to ' + to, dir))
          }
        } else actions.push(action('ability', ability.ability))
      }
      for (const item of Object.values(cryptid.memories).filter(item => equipmentAt(item, pos))) {
        actions.push(action('destroy', 'Destroy ' + GEAR[item.type].unit.toLowerCase(), item.id))
      }
      if (MAP[pos].type !== 'r') {
        for (const dir of Object.keys(MAP[pos].exits)) actions.push(action('mislead', 'Leave false tracks ' + directionNames[dir], dir))
      }
    }
  }
  return {
    ...shared, role: 'cryptid', player: {
      ...shared.player, restrained: Boolean(cryptid.restraint), hunger: cryptid.hunger,
      ability, charges: cryptid.charges,
    },
    cryptid: { pos, live: true, name: cryptid.species, restrained: Boolean(cryptid.restraint) },
    animals: state.animals.flatMap(animal => {
      const { id, species, status } = animal
      if (status !== 'alive' && status !== 'carried' && status !== 'ground') return []
      return [{ id, species, name: SPECIES[species].name, pos: animalPosition(state, animal), live: true, status: 'alive' }]
    }),
    devices: Object.values(cryptid.memories).map(device => ({ ...device, remembered: !equipmentAt(device, pos) })),
    chargeGrowths: state.chargeGrowths.map(({ pos }) => ({ pos })),
    snares: state.cryptidSnares.map(({ pos, activated }) => ({ pos, activated })),
    clues: state.clues.filter(clue => clue.type !== 'sighting' && (!clue.device || clue.cryptidKnows)).map(({ id, type, pos, round, dir, falseTrail }) => ({
      id, type, pos, name: type === 'tracks' ? (falseTrail ? 'False trail' : 'Footprints') + ' heading ' + directionNames[dir] : EVIDENCE[type].name,
      date: 'Round ' + round,
    })).reverse(),
    ready, canEnd: ready, actions, logs: state.logs.cryptid, sites: [],
    moves: ready && cryptid.ap && !cryptid.restraint ? Object.values(MAP[pos].exits).filter(to => canCryptidTravel(state, pos, to)) : [],
  }
}

export function matchView(state, actor) {
  const hunter = state.hunters.find(member => member.id === actor)
  const local = hunter ?? state.cryptid
  const privateHunterPhase = Boolean(hunter)
  const shared = {
    round: state.round, phase: state.phase, winner: state.winner, species: state.cryptid.species,
    player: { id: local.id, name: local.name, pos: local.pos, ap: local.ap },
    hunters: state.hunters.map(({ id, name, index, pos, ap, ended, restraint, hunterClass }) => ({
      id, name, index, pos, ...(privateHunterPhase ? { ap, ended, restrained: Boolean(restraint), className: HUNTER_CLASSES[hunterClass]?.name } : {}),
    })),
    gas: [...state.gas.keys()],
  }
  return hunter ? hunterView(state, hunter, shared) : cryptidView(state, shared)
}
