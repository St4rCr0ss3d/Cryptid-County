import { CAMP, MAP, GEAR, EVIDENCE, SPECIES, RULES, CRYPTIDS, HUNTER_CLASSES, directionNames, CRYPTID_ACTION_COST, SNEAK_MOVEMENT_COST, FACTIONS, gearAvailable } from './config.js'
import { assessEvidence, blockadeTargets, canForage, canPhotograph, canCryptidTravel, equipmentAt, equipmentCapacity, flyDestinations, cargoCapacity, deployCost, photoCost, gasCost, rifleCost, shopPrice, hunterEquipment, hunterMovementLeft, hunterMovementLimit, trailAge, isTrail, isLive, isMounted, lureTargets, shriekTargets, cryptidGoal, sensedEquipmentSectors, phantomTargets, wildlifeOnMap, canMislead, hasSearchedHere, ultimateCooldown, occupiedSnare, canDestroyEquipment, isVideoDevice, cameraHasActivity } from './game.js'

const gear = packs => packs.map(({ id, type, qty }) => ({ id, type, qty }))
const evidence = ({ id, type }) => ({ id, type, name: EVIDENCE[type].name, description: EVIDENCE[type].description })
const cargo = item => item.species
  ? { id: item.id, species: item.species, name: SPECIES[item.species].name + ' carcass', description: 'Sell at base camp for expedition funding or store at a field site.' }
  : evidence(item)

function clueView(state, clue, hunter) {
  const age = state.round - clue.round
  const expired = !isLive(state, clue)
  const trail = isTrail(clue.type)
  const date = clue.discovery.exact
    ? (trail && age <= 1 ? 'Fresh' : age + (age === 1 ? ' round ago' : ' rounds ago'))
    : (age <= RULES.freshThrough ? 'Fresh' : 'Cold')
  const direction = directionNames[clue.dir]
  let name
  if (clue.type === 'tracks') {
    const role = HUNTER_CLASSES[hunter.hunterClass]
    const identifiesTracks = role?.readsFalse || role?.exactTracks || hunter.gear.some(pack => pack.type === 'kit' && pack.qty > 0)
    const identified = state.cryptid.photoIdentified || (identifiesTracks && (!clue.falseTrail || role?.readsFalse))
    const falseLabel = role?.readsFalse && clue.falseTrail ? 'False ' : ''
    name = falseLabel + (identified ? state.cryptid.species : 'Cryptid') + ' tracks' + (direction ? ' ' + direction : '')
  } else {
    const label = clue.type === 'animalTracks' ? SPECIES[clue.animalSpecies].name + ' tracks' : EVIDENCE[clue.type].name
    name = label + (direction && (clue.type !== 'blood' || clue.discovery.exact) ? ' heading ' + direction : '')
  }
  return { id: clue.id, type: clue.type, name, date, pos: clue.pos, expired,
    collected: Boolean(clue.collected), discovered: clue.discovery.round, animalSpecies: clue.animalSpecies,
    ...(trail ? { trackAge: trailAge(age) } : {}) }
}

const discoveryArt = {
  tracks: 'tracks', blood: 'blood', feed: 'remains',
  damage: 'damage', sighting: 'sighting', scat: 'tag',
}

export function searchView(match, findings) {
  const cards = []
  const add = (artwork, label) => {
    if (artwork) cards.push({ artwork, label })
  }
  const clueIds = new Set(findings.clueIds)
  for (const clue of match.clues.filter(item => clueIds.has(item.id))) {
    add(clue.type === 'animalTracks' ? clue.animalSpecies : discoveryArt[clue.type], clue.trackAge ? clue.name + ' · ' + clue.trackAge : clue.name)
  }
  for (const animal of findings.wildlife) {
    const detail = animal.status === 'ground' ? ' carcass' : animal.snared ? ' caught in a snare' : ''
    add(animal.status === 'ground' ? 'remains' : animal.species, SPECIES[animal.species].name + detail)
  }
  return { sector: findings.sector, cards }
}

function animalPosition(state, animal) {
  if (animal.status === 'carried') return state.hunters.find(hunter => hunter.id === animal.owner).pos
  return animal.pos
}

function hunterAnimals(state) {
  return wildlifeOnMap(state).flatMap(animal => {
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
  const latestClueRound = clues.reduce((latest, clue) =>
    !clue.collected && isLive(state, clue) ? Math.max(latest, clue.round) : latest, 0)
  const discoveries = clues.map(clue => {
    const view = clueView(state, clue, hunter)
    return { ...view, onMap: !view.collected && !view.expired && clue.round === latestClueRound }
  }).reverse()
  const animals = hunterAnimals(state)
  const cryptidHere = cryptid.seen && cryptid.pos === hunter.pos
  const ready = state.phase === 'hunters' && !hunter.ended && !state.winner
  const mounted = isMounted(hunter)
  const canOperate = ready && !hunter.restraint && !mounted
  const canAct = canOperate && hunter.ap > 0
  const canMove = ready && hunterMovementLeft(hunter) > 0 && !hunter.restraint
  const capacity = equipmentCapacity(hunter)
  const has = type => hunter.gear.some(pack => pack.type === type && pack.qty > 0)
  const cargoRoom = hunter.cargo.length < cargoCapacity(hunter)
  const searchedHere = hasSearchedHere(state, hunter)
  const actions = []
  if (ready && mounted && hunter.ap >= 1) actions.push(action('toggleBike', 'Dismount bike · 1 AP'))
  if (ready && !mounted && hunter.restraint && hunter.ap >= RULES.escapeAP) {
    actions.push(action('escape', 'Escape Cryptid snare · 2 AP'))
  }
  if (canAct) {
    if (!searchedHere && hunter.ap >= RULES.searchAP) actions.push(action('search', 'Search this space'))
    if (hunter.hunterClass === 'biker' && hunter.bikePos === hunter.pos) {
      actions.push(action('toggleBike', 'Mount bike · 1 AP'))
    }
    if (cryptidHere && state.faction === 'researchers') {
      if (cryptid.restraint && hunter.ap >= 2) actions.push(action('capture', 'Capture Cryptid · 2 AP'))
      if (!cryptid.restraint && cryptid.species === 'Sasquatch' && has('netgun')) actions.push(action('shoot', 'Launch reinforced net · 1 AP'))
    }
    if (cryptidHere && state.faction === 'hunters') {
      if (has('rangefinder') && (state.rangeMark?.round !== state.round || state.rangeMark.pos !== hunter.pos)) {
        actions.push(action('range', 'Range target · 1 AP'))
      }
      const shotCost = rifleCost(state, hunter)
      if (has('rifle') && hunter.ap >= shotCost && hunter.shotRound !== state.round) {
        actions.push(action('fireRifle', (cryptid.wounded ? 'Finishing shot' : 'Wounding shot') + ' · ' + shotCost + ' AP'))
      }
    }
    if (hunter.ap >= RULES.cameraSearchAP) {
      const cameras = state.devices.filter(item => isVideoDevice(item) && item.owner === hunter.id &&
        !hasSearchedHere(state, hunter, item.pos))
      for (const device of cameras) {
        const inSector = cameras.filter(item => item.pos === device.pos)
        const detail = inSector.length > 1 ? ' · ' + GEAR[device.type].unit + ' ' + (inSector.indexOf(device) + 1) : ''
        actions.push(action('checkCamera', 'Check ' + device.pos + detail, device.id, { signal: cameraHasActivity(device) || (state.spoofedAlarm?.id === device.id && !state.spoofedAlarm.investigated) }))
      }
    }
    for (const animal of animals.filter(item => item.live && item.pos === hunter.pos)) {
      const actual = wildlifeOnMap(state).find(item => item.id === animal.id && item.pos === hunter.pos && item.status === animal.status)
      if (!actual) continue
      if (animal.status === 'alive') {
        if (state.faction === 'hunters' && cargoRoom && (actual.snare || has('rifle'))) {
          actions.push(action('hunt', 'Hunt ' + animal.name + (actual.snare ? '' : ' · 1 rifle round'), animal.id))
        }
        if (state.faction === 'researchers' && actual.snare && has('tag') && !animal.tagged) actions.push(action('tag', 'Tag ' + animal.name, animal.id))
      }
      if (animal.status === 'ground' && cargoRoom) actions.push(action('takeGround', 'Pick up ' + animal.name + ' carcass', animal.id))
    }
    for (const clue of clues.filter(item => item.pos === hunter.pos && !item.collected &&
      !clueView(state, item, hunter).expired && (item.type !== 'sighting' || item === cryptid.seen))) {
      if (cargoRoom && EVIDENCE[clue.type].collectible) {
        const preserve = state.faction === 'fans' && clue.type === 'feed' && has('sampleKit')
        actions.push(preserve ? action('preserve', 'Preserve verified sample · 1 AP', clue.id)
          : action('collect', 'Collect ' + EVIDENCE[clue.type].name.toLowerCase(), clue.id))
      }
    }
    for (const device of local) {
      if (device.type === 'blockade') {
        if (HUNTER_CLASSES[hunter.hunterClass]?.blockades) actions.push(action('recover', 'Recover blockade · ' + device.pos + '–' + device.to, device.id))
        continue
      }
      const canFit = hunter.gear.length < capacity || hunter.gear.some(pack =>
        pack.type === device.type && pack.qty < GEAR[pack.type].size)
      if (canFit && !occupiedSnare(state, device) &&
          (device.type !== 'tent' || (!device.gear.length && !device.cargo.length))) {
        actions.push(action('recover', 'Recover ' + GEAR[device.type].unit.toLowerCase(), device.id))
      }
    }
    for (const pack of hunter.gear) {
      if (['netgun', 'rifle'].includes(pack.type) && pack.qty < GEAR[pack.type].size && has(pack.type === 'rifle' ? 'rifleAmmo' : 'ammo')) {
        actions.push(action('reload', 'Reload ' + GEAR[pack.type].name.toLowerCase(), pack.id))
      }
    }
  }
  if (canOperate) {
    const costToGas = gasCost(state, hunter)
    if (has('gas') && hunter.ap >= costToGas) actions.push(action('gas', 'Use tear gas · ' + costToGas + ' AP'))
    for (const clue of clues) {
      const cost = photoCost(state, hunter, clue.type)
      if (hunter.ap < cost || clue.pos !== hunter.pos || clue.collected || !isLive(state, clue) ||
        EVIDENCE[clue.type].price <= 0 || !canPhotograph(hunter, clue) ||
        (clue.type === 'sighting' && clue !== cryptid.seen)) continue
      actions.push(action('photo', 'Photograph ' + clueView(state, clue, hunter).name.toLowerCase() + ' · ' + cost + ' AP', clue.id))
    }
    for (const [type, definition] of Object.entries(GEAR)) {
      const cost = deployCost(state, hunter, type)
      if (definition.deploy && has(type) && hunter.ap >= cost) {
        actions.push(action('deploy', 'Deploy ' + definition.unit.toLowerCase() + (cost ? '' : ' · 0 AP'), type))
      }
    }
  }
  if (canOperate) {
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
      movement: hunterMovementLeft(hunter), maxMovement: hunterMovementLimit(hunter), bikePos: hunter.bikePos,
      cargo: hunter.cargo.map(item => item.species ? cargo(item) : { ...evidence(item), value: assessment.get(item.id) }),
      hunterClass: hunter.hunterClass, className: HUNTER_CLASSES[hunter.hunterClass]?.name,
      bikeDescription: hunter.hunterClass === 'biker' ? HUNTER_CLASSES.biker.description : undefined,
      hasBlockadeGear: Boolean(HUNTER_CLASSES[hunter.hunterClass]?.blockades),
      equipmentCapacity: capacity, cargoCapacity: cargoCapacity(hunter), blockades: hunter.blockades,
      digital: hunter.digital.map(item => ({
        ...evidence(item), photo: Boolean(item.photo), video: Boolean(EVIDENCE[item.type].video),
        value: assessment.get(item.id), trackAge: item.trackAge, damageAge: item.brokenRound == null ? undefined : state.round - item.brokenRound,
      })),
      restrained: Boolean(hunter.restraint), ended: hunter.ended, searchedHere,
    },
    cash: state.cash, upkeep: state.upkeep, supportGrant: state.supportGrant,
    shop: Object.fromEntries(Object.keys(GEAR).filter(type => gearAvailable(type, state.faction)).map(type => [type, shopPrice(hunter, type)])),
    proof: state.faction === 'fans' ? { count: state.proof.size, visual: [...state.proof.values()].includes('visual') } : undefined, clues: discoveries, animals,
    cryptid: !cryptid.disguise && (cryptid.seen || cryptid.tagged) ? { pos: cryptid.pos, live: true, restrained: Boolean(cryptid.restraint), name: cryptid.species, ...(cryptid.tagged ? { tagged: true } : {}) }
      : cryptid.lastSeen ? { ...cryptid.lastSeen, live: false, name: cryptid.species } : null,
    devices: [...equipment.map(({ id, type, pos, to, activated }) => ({ id, type, pos, ...(to ? { to } : {}), activated: type === 'blockade' ? undefined : state.spoofedAlarm?.id === id && !state.spoofedAlarm.investigated ? state.spoofedAlarm.round : activated })), ...damage],
    snares: state.cryptidSnares.filter(snare => snare.discovered).map(({ pos, activated }) => ({ pos, activated })),
    sites: sites.map(site => ({ id: site.id, name: site.id === CAMP ? 'Base camp' : 'Tent cache',
      camp: site.id === CAMP, gear: gear(site.gear), cargo: site.cargo.map(cargo) })),
    warning, warnings, actions, ready, canEnd: ready, logs: state.logs.hunters,
    blockadeTargets: canAct ? blockadeTargets(state, hunter) : [],
    moves: canMove ? Object.values(MAP[hunter.pos].exits) : [],
  }
}

function cryptidView(state, shared) {
  const { cryptid } = state
  const { pos } = cryptid
  const sensedSectors = sensedEquipmentSectors(cryptid)
  const ability = CRYPTIDS[cryptid.species]
  const ready = state.phase === 'cryptid' && !state.winner
  const foods = state.animals.filter(animal => animal.pos === pos &&
    (animal.status === 'alive' || animal.status === 'ground'))
  const actions = []
  if (ready && cryptid.ap) {
    if (cryptid.restraint) {
      if (cryptid.ap >= RULES.escapeAP) actions.push(action('escape', 'Escape restraint · 2 AP'))
    }
    else {
      if (cryptid.ultimateUnlocked && !ultimateCooldown(state) && cryptid.ap >= ability.nightAP) {
        const { name } = ability.ultimate
        const cost = ability.nightAP
        if (cryptid.species === 'Mothman') {
          for (const { dir, to } of cryptid.movementLost ? [] : flyDestinations(state, 4)) actions.push(action('ultimate', name + ' to ' + to + ' · ' + cost + ' AP', dir))
        } else if (cryptid.species === 'Mimic') {
          for (const [type, animal] of Object.entries(SPECIES)) actions.push(action('ultimate', 'Become ' + animal.name.toLowerCase() + ' · ' + cost + ' AP', type))
        } else actions.push(action('ultimate', name + ' · ' + cost + ' AP'))
      }
      if (cryptid.ap >= CRYPTID_ACTION_COST.setSnare && cryptid.snareRound !== state.round &&
        !state.cryptidSnares.some(snare => snare.pos === pos)) {
        actions.push(action('setSnare', 'Set hidden snare · 3 AP'))
      }
      if (cryptid.ap >= CRYPTID_ACTION_COST.forage && canForage(cryptid)) {
        actions.push(action('forage', 'Forage · 2 AP · ' + (RULES.forageChance * 100) + '% success'))
      }
      const canFlush = cryptid.ap >= CRYPTID_ACTION_COST.flush && foods.some(animal => animal.status === 'alive' && !animal.snare)
      for (const [dir, to] of Object.entries(MAP[pos].exits)) {
        if (canFlush) actions.push(action('flush', 'Flush wildlife ' + directionNames[dir] + ' · 2 AP', to))
        if (cryptid.ap >= CRYPTID_ACTION_COST.sneak && cryptid.movement >= SNEAK_MOVEMENT_COST && canCryptidTravel(state, pos, to)) {
          actions.push(action('sneak', 'Sneak ' + directionNames[dir] + ' · 2 AP + 2 movement', to))
        }
      }
      for (const animal of foods) actions.push(action('feed', 'Feed on ' + SPECIES[animal.species].name, animal.id))
      if (!ability.passive && cryptid.ap >= ability.abilityCost) {
        if (cryptid.species === 'Mothman') {
          for (const { dir, to } of cryptid.movementLost ? [] : flyDestinations(state)) {
            actions.push(action('ability', 'Fly ' + directionNames[dir] + ' to ' + to + ' · ' + ability.abilityCost + ' AP', dir))
          }
        } else if (cryptid.species === 'Chupacabra') {
          for (const animal of lureTargets(state)) {
            actions.push(action('ability', 'Lure ' + SPECIES[animal.species].name.toLowerCase() + ' from ' + animal.pos + ' · ' + ability.abilityCost + ' AP', animal.id))
          }
        } else if (cryptid.species === 'Mimic') {
          if (phantomTargets(state).length) actions.push(action('ability', ability.ability + ' · ' + ability.abilityCost + ' AP'))
        } else if (cryptid.species !== 'Jersey Devil' || shriekTargets(state).length) {
          actions.push(action('ability', ability.ability + ' · ' + ability.abilityCost + ' AP'))
        }
      }
      for (const item of Object.values(cryptid.memories).filter(item => canDestroyEquipment(item) && equipmentAt(item, pos))) {
        actions.push(action('destroy', 'Destroy ' + GEAR[item.type].unit.toLowerCase(), item.id))
      }
      if (canMislead(cryptid)) {
        for (const dir of Object.keys(MAP[pos].exits)) actions.push(action('mislead', 'Leave false tracks ' + directionNames[dir], dir))
      }
    }
  }
  return {
    ...shared, role: 'cryptid',
    goal: cryptidGoal(state),
    ultimate: { ...ability.ultimate, cost: ability.nightAP, unlocked: cryptid.ultimateUnlocked, cooldown: Math.min(RULES.ultimateCooldown, ultimateCooldown(state)) },
    player: {
      ...shared.player, restrained: Boolean(cryptid.restraint), hunger: cryptid.hunger, wounded: cryptid.wounded,
      ability, maxAP: ability.nightAP, disguise: cryptid.disguise ? SPECIES[cryptid.disguise.species].name : undefined,
      movement: cryptid.movement, maxMovement: ability.nightMovement,
    },
    cryptid: { pos, live: true, name: cryptid.species, restrained: Boolean(cryptid.restraint) },
    animals: state.animals.flatMap(animal => {
      const { id, species, status } = animal
      if (status !== 'alive' && status !== 'carried' && status !== 'ground') return []
      return [{ id, species, name: SPECIES[species].name, pos: animalPosition(state, animal), live: true, status: 'alive' }]
    }),
    devices: Object.values(cryptid.memories).map(device => ({ ...device,
      remembered: !sensedSectors.some(sector => equipmentAt(device, sector)),
    })),
    snares: state.cryptidSnares.map(({ pos, activated }) => ({ pos, activated })),
    clues: state.clues.filter(clue => clue.type !== 'sighting' && clue.type !== 'animalTracks' && (!clue.device || clue.cryptidKnows)).map(({ id, type, pos, round, dir, falseTrail }) => ({
      id, type, pos, name: type === 'tracks' ? (falseTrail ? 'False trail' : 'Footprints') + ' heading ' + directionNames[dir] : EVIDENCE[type].name,
      date: 'Round ' + round,
    })).reverse(),
    ready, canEnd: ready, actions, logs: state.logs.cryptid, sites: [],
    moves: ready && cryptid.movement && !cryptid.restraint ? Object.values(MAP[pos].exits).filter(to => canCryptidTravel(state, pos, to)) : [],
  }
}

export function matchView(state, actor, hunterId) {
  const controlled = state.hunters.filter(member => (member.ownerId ?? member.id) === actor)
  const hunter = controlled.find(member => member.id === hunterId) ?? controlled[0]
  const local = hunter ?? state.cryptid
  const privateHunterPhase = Boolean(hunter)
  const shared = {
    round: state.round, phase: state.phase, winner: state.winner, winReason: state.winReason, faction: FACTIONS[state.faction],
    ...(hunter && !state.cryptid.seen && !state.cryptid.lastSeen && !state.cryptid.photoIdentified && !state.winner ? {} : { species: state.cryptid.species }),
    player: { id: local.id, name: local.name, pos: local.pos, ap: local.ap, maxAP: RULES.actions },
    hunters: state.hunters.map(({ id, name, index, pos, ap, ended, restraint, hunterClass, bikePos }) => ({
      id, name, index, pos, ...(privateHunterPhase ? { ap, ended, restrained: Boolean(restraint), className: HUNTER_CLASSES[hunterClass]?.name, bikePos } : {}),
    })),
    gas: [...state.gas.keys()],
  }
  return hunter ? { ...hunterView(state, hunter, shared), controlledHunterIds: controlled.map(member => member.id) }
    : cryptidView(state, shared)
}
