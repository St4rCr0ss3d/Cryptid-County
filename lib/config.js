export const SIZE = 7
export const CAMP = 'D7'
export const DIRECTIONS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
export const directionNames = { N: 'north', E: 'east', S: 'south', W: 'west' }

const terrain = [
  'wwppppr',
  'mmwprrr',
  'mwwcwrr',
  'mmcccwr',
  'mwwcwww',
  'wwwwrww',
  'wwwwwww',
]
const terrainNames = { w: 'Woodland', p: 'Pine forest', r: 'Rocky hills', m: 'Wetland', c: 'Clearing' }
const blocked = [
  ['C1', 'C2'], ['E1', 'E2'], ['F1', 'F2'], ['B2', 'C2'],
  ['E2', 'F2'], ['G2', 'G3'], ['A3', 'B3'], ['D3', 'E3'],
  ['A4', 'A5'], ['B4', 'C4'], ['E4', 'F4'], ['F4', 'F5'], ['B5', 'B6'],
  ['A6', 'B6'], ['C6', 'D6'], ['E6', 'F6'], ['F6', 'G6'],
  ['B7', 'C7'], ['E7', 'F7'],
]
const landmarks = { D7: 'Base camp', D4: 'Elk Meadow', A4: 'Blackwater Marsh', F2: 'Raven Ridge', D1: 'North Pines', B5: 'Timber Ford' }
const at = (x, y) => terrain[y]?.[x] ? String.fromCharCode(65 + x) + (y + 1) : null

export const MAP = Object.fromEntries(terrain.flatMap((row, y) => [...row].map((type, x) => {
  const id = at(x, y)
  const exits = Object.fromEntries(Object.entries(DIRECTIONS).flatMap(([dir, [dx, dy]]) => {
    const destination = at(x + dx, y + dy)
    return destination && !blocked.some(pair => pair.includes(id) && pair.includes(destination))
      ? [[dir, destination]] : []
  }))
  return [id, { id, x, y, type, terrain: terrainNames[type], name: landmarks[id] ?? terrainNames[type], exits }]
})))

export const GEAR = {
  netgun: { faction: 'researchers', name: 'Reinforced net launcher', size: 2, price: 110, description: 'Two shots. Restrains a confirmed Sasquatch in your sector.' },
  ammo: { faction: 'researchers', name: 'Spare capture nets', size: 2, price: 35, description: 'Reloads up to two shots in a reinforced net launcher.' },
  snare: { name: 'Snares', unit: 'Snare', size: 3, price: 75, deploy: true, description: 'Catches live wildlife and sounds an anonymous alert. Rabbits stay caught, turkeys have a 25% chance to break free per wildlife turn, and deer break free on the next wildlife turn.' },
  camera: { name: 'Trail cameras', unit: 'Trail camera', size: 2, price: 70, deploy: true, description: 'Records silently. Only the deployer can search its sector remotely for 2 AP. Visit to retrieve recordings.' },
  tag: { faction: 'researchers', name: 'Animal tags', size: 3, price: 45, description: 'Tags a live snared animal. Its signal can persist after feeding.' },
  detector: { name: 'Motion detectors', unit: 'Motion detector', size: 3, price: 45, deploy: true, description: 'Reports movement without identifying its source.' },
  gas: { name: 'Tear gas', size: 1, price: 45, description: 'Scatters occupants, breaks restraints, and blocks Cryptid entry for the next two Night turns.' },
  tent: { name: 'Backpack tent', unit: 'Tent', size: 1, price: 85, deploy: true, description: 'Creates a field cache and evidence submission site.' },
  kit: { name: 'Field kit', size: 1, price: 60, description: 'While carried, Search reveals precise clue ages and identifies the species pattern in genuine Cryptid tracks.' },
  anchor: { faction: 'researchers', name: 'Anchored capture snares', unit: 'Anchored capture snare', size: 1, price: 125, deploy: true, description: 'Restrains Sasquatch on the ground.' },
  aerial: { faction: 'researchers', name: 'Aerial capture nets', unit: 'Aerial capture net', size: 1, price: 135, deploy: true, description: 'Restrains Mothman after a flight into this sector.' },
  resonance: { faction: 'researchers', name: 'Resonance snare', unit: 'Resonance snare', size: 1, price: 130, deploy: true, description: 'Restrains the Jersey Devil if it shrieks in this sector.' },
  baitCage: { faction: 'researchers', name: 'Bait cage', unit: 'Bait cage', size: 1, price: 130, deploy: true, description: 'Restrains the Chupacabra when it tries to feed on wildlife in this sector.' },
  voiceTrap: { faction: 'researchers', name: 'Voiceprint snare', unit: 'Voiceprint snare', size: 1, price: 130, deploy: true, description: 'Restrains the Mimic if it uses Phantom Trigger from this sector.' },
  rifle: { faction: 'hunters', name: 'Hunting rifle', size: 2, price: 175, description: 'Loaded with two rounds. One hit wounds a confirmed Cryptid in your sector and a second kills it. Works on free and restrained targets. A free animal costs one round to hunt.' },
  rifleAmmo: { faction: 'hunters', name: 'Rifle ammunition', size: 2, price: 45, description: 'Reloads up to two rounds in a hunting rifle.' },
  rangefinder: { faction: 'hunters', name: 'Rangefinder', size: 1, price: 75, description: 'Range a confirmed target in your sector. The next rifle shot there this Day costs 1 AP.' },
  bloodKit: { faction: 'hunters', name: 'Blood-trail kit', size: 1, price: 65, description: 'Searching blood reveals the direction and age of a wounded Cryptid’s ground trail, even if it snuck or planted false footprints. Flight leaves a gap in the trail.' },
  lowLight: { faction: 'fans', name: 'Low-light video camera', unit: 'Low-light camera', size: 1, price: 140, deploy: true, description: 'Records verified footage silently. Only the deployer can search its sector remotely for 2 AP. Visit to retrieve recordings.' },
  mic: { faction: 'fans', name: 'Directional microphones', unit: 'Directional microphone', size: 2, price: 95, deploy: true, description: 'Records verified audio when the Cryptid performs an observable action in this sector. Retrieve and submit it to support the Fans’ proof objective.' },
  sampleKit: { faction: 'fans', name: 'Sealed sample kit', size: 2, price: 80, description: 'Use one kit on discovered Cryptid feeding remains to create a verified sample. Submit it at camp or a tent.' },
  blockade: { name: 'Trail blockade', unit: 'Trail blockade', size: 1, classGear: true, description: 'Closes one connected trail to Cryptid ground movement. A blockade specialist can recover and redeploy it. Cryptids cannot destroy it.' },
}

export const FACTIONS = {
  researchers: { name: 'Researchers', objective: 'Identify the Cryptid, restrain it with matching gear, and capture it alive.', outcome: 'Cryptid captured' },
  hunters: { name: 'Hunters', objective: 'Confirm the Cryptid, wound it, and land a finishing shot.', outcome: 'Cryptid killed' },
  fans: { name: 'Fans', objective: 'Submit two independent verified records, including clear footage.', outcome: 'Existence proven' },
}
export const gearAvailable = (type, faction) => Object.hasOwn(GEAR, type) && !GEAR[type].classGear &&
  (!GEAR[type].faction || GEAR[type].faction === faction)
export const HUNTER_CLASSES = {
  ranger: { faction: 'researchers', name: 'Habitat Surveyor', description: 'Start with two reusable trail blockades. Close ground routes to guide the Cryptid toward a monitored capture site.', blockades: 2 },
  biker: { faction: 'researchers', name: 'Field Mobility Specialist', description: 'Scout observation sites on your personal off-road bike for 4 movement. Mount or dismount for 1 AP. Dismount to take field actions. Ride through snares without triggering them.' },
  prepper: { faction: 'researchers', name: 'Expedition Quartermaster', description: 'Bring a loaded Sasquatch net launcher, four gear slots, and $200 extra expedition funding.', equipment: 4, bonusCash: 200, startingPack: 'netgun' },
  trapper: { faction: 'researchers', name: 'Live-Capture Technician', description: 'Start with an anchored Sasquatch snare for a live study. Your first snare or capture net deployment each Day costs 0 AP.', startingPack: 'anchor', freeDeploy: ['snare', 'anchor', 'aerial'] },
  biologist: { faction: 'researchers', name: 'Field Biologist', description: 'Start with animal tags. Read precise clue ages and identify species from authentic tracks without a field kit.', startingPack: 'tag', exactTracks: true },
  rescue: { faction: 'researchers', name: 'Field Safety Officer', description: 'Start with tear gas for emergency evacuation. Your first tear-gas use each Day costs 0 AP.', startingPack: 'gas', freeGas: true },
  marksman: { faction: 'hunters', name: 'Marksman', description: 'Start with a rangefinder. A rifle shot costs you 1 AP instead of 2. One shot per Day.', startingPack: 'rangefinder', rifleCost: 1 },
  tracker: { faction: 'hunters', name: 'Blood Tracker', description: 'Start with a blood-trail kit. Recognize fake tracks and learn species from authentic tracks.', startingPack: 'bloodKit', readsFalse: true, exactTracks: true },
  outfitter: { faction: 'hunters', name: 'Outfitter', description: 'Carry five gear packs and start with spare rifle ammunition and $100 extra funding.', equipment: 5, startingPack: 'rifleAmmo', bonusCash: 100 },
  outrider: { faction: 'hunters', name: 'Ridge Runner', description: 'Start with motion detectors. Your first detector deployment each Day costs 0 AP.', startingPack: 'detector', freeDeploy: ['detector'] },
  warden: { faction: 'hunters', name: 'Backcountry Warden', description: 'Start with tear gas and one reusable trail blockade. Close a route or drive the quarry out.', startingPack: 'gas', blockades: 1 },
  armorer: { faction: 'hunters', name: 'Armorer', description: 'Start with a loaded rifle and receive a 25% discount on rifles and rifle ammunition you buy.', startingPack: 'rifle', discount: ['rifle', 'rifleAmmo'] },
  believer: { faction: 'fans', name: 'True Believer', description: 'Recognize fake tracks and earn 25% more for submitted photos and videos.', mediaMultiplier: 1.25, readsFalse: true },
  videographer: { faction: 'fans', name: 'Night Videographer', description: 'Start with a low-light camera. Your first camera deployment each Day costs 0 AP.', startingPack: 'lowLight', freeDeploy: ['camera', 'lowLight'] },
  acoustician: { faction: 'fans', name: 'Acoustic Surveyor', description: 'Start with two directional microphones. Your first microphone deployment each Day costs 0 AP.', startingPack: 'mic', freeDeploy: ['mic'] },
  naturalist: { faction: 'fans', name: 'Sample Naturalist', description: 'Start with a sealed sample kit. Carry five cargo items and read precise clue ages without a field kit.', startingPack: 'sampleKit', cargo: 5, exactTracks: true },
  cyclist: { faction: 'fans', name: 'Trail Vlogger', description: 'Start with a basic trail camera. Photograph one clue other than footprints or a Cryptid sighting for 0 AP each Day.', startingPack: 'camera', freePhoto: true },
  producer: { faction: 'fans', name: 'Field Producer', description: 'Start with a field tent and $150 extra funding. Pay 25% less for tents and low-light cameras you buy.', startingPack: 'tent', bonusCash: 150, discount: ['tent', 'lowLight'] },
}
export const classesFor = faction => Object.fromEntries(Object.entries(HUNTER_CLASSES).filter(([, role]) => role.faction === faction))
export const CRYPTIDS = {
  Sasquatch: { nightAP: 9, nightMovement: 3, ability: 'Sense equipment', passive: true, description: 'Automatically sense equipment in your sector and all eight surrounding sectors, even across blocked trails.', ultimate: { name: 'Rampage', description: 'Destroy expedition equipment in your sector and the eight surrounding sectors. Trail blockades survive.' }, goal: { event: 'sabotage', target: 5, groups: 3, groupLabel: 'Sectors', description: 'Destroy five expedition devices across at least three sectors.' } },
  Mothman: { nightAP: 6, nightMovement: 3, ability: 'Fly', description: 'Fly two tiles in a cardinal direction, crossing blocked ground routes.', abilityCost: 4, ultimate: { name: 'Long Flight', description: 'Fly four sectors in a cardinal direction, bypassing obstacles along the way.' }, goal: { event: 'landmark', target: 4, nights: 3, description: 'Fly into four different named landmarks across at least three Nights.' } },
  'Jersey Devil': { nightAP: 7, nightMovement: 3, ability: 'Terrifying shriek', abilityCost: 5, description: 'Frighten expedition members in this sector and connected sectors. Each starts the next Day with 1 less AP.', ultimate: { name: 'Countywide Shriek', description: 'Every expedition member starts the next Day with just 1 AP.' }, goal: { event: 'frighten', target: 6, nights: 3, description: 'Frighten expedition members six times across at least three Nights. Each member counts once per Night.' } },
  Chupacabra: { nightAP: 8, nightMovement: 4, ability: 'Lure wildlife', abilityCost: 4, description: 'Draw a free animal from a connected sector into this sector when the habitat is suitable.', ultimate: { name: 'Predator’s Surge', description: 'Reset hunger to zero and gain 3 additional movement this Night.' }, goal: { event: 'feed', target: 5, groups: 3, groupLabel: 'Prey species', nights: 3, description: 'Feed on five animals across at least three Nights, including a rabbit, a wild turkey, and a deer.' } },
  Mimic: { nightAP: 8, nightMovement: 3, ability: 'Phantom Trigger', abilityCost: 5, description: 'Spoof an alert from random deployed equipment outside your sector and its eight neighbors.', ultimate: { name: 'Animal Form', description: 'Become a rabbit, wild turkey, or deer through the next two Days. Wildlife snares and tags work on you. A Hunter who shoots you exposes your disguise and ends their turn.' }, goal: { event: 'decoy', target: 4, groups: 2, groupLabel: 'Members fooled', description: 'Get at least two different expedition members to Search four spoofed equipment alerts.' } },
}
export function offsetSector(pos, dir, distance = 1) {
  const { x, y } = MAP[pos]
  const [dx, dy] = DIRECTIONS[dir]
  return at(x + dx * distance, y + dy * distance)
}

export const RULES = {
  2: { upkeep: 100, supportGrant: 600 },
  3: { upkeep: 120 },
  startingCash: 2000,
  actions: 3, searchAP: 1, cameraSearchAP: 2, escapeAP: 2, hunterMovement: 2, mountedMovement: 4, equipment: 3, cargo: 3, startHunger: 0, maxHunger: 5,
  gasTurns: 2,
  forageChance: .2,
  ultimateCooldown: 2, mimicFormDuration: 2, footprintLife: 4, otherClueLife: 12, freshThrough: 2,
  evidenceSaleCurve: [1, .8, .65, .5, .35, .2, .1],
  meatSaleCurve: [1, .6, .3, .1],
  minPhotoPayout: 5,
  minVideoPayout: 25,
  tagRemainsChance: .4,
}
export const SNEAK_MOVEMENT_COST = 2
export const CRYPTID_ACTION_COST = { sneak: 2, forage: 2, flush: 2, setSnare: 3 }
export const SPECIES = {
  rabbit: { name: 'Rabbit', snareBreakChance: 0, food: 2, price: 60, allowed: 'wpc', preferred: 'wp', spawns: ['B1', 'E3', 'C6', 'G5', 'B3'] },
  turkey: { name: 'Wild turkey', snareBreakChance: .25, food: 3, price: 90, allowed: 'wpcm', preferred: 'wc', spawns: ['C3', 'D4', 'F5'] },
  deer: { name: 'Deer', snareBreakChance: 1, food: 5, price: 125, allowed: 'wpcm', preferred: 'cm', spawns: ['B4', 'D3'] },
}
export const EVIDENCE = {
  tracks: { name: 'Footprints', description: "Shows the direction the track appears to lead. Submit a photo for funding.", price: 60 },
  animalTracks: { name: 'Animal tracks', description: "Shows which animal passed through and where it headed. Useful for scouting.", price: 0 },
  blood: { name: 'Blood trail', description: "Left by a wounded Cryptid. A blood-trail kit can reveal the trail’s direction and age.", price: 70 },
  clearVideo: { name: 'Clear Cryptid footage', description: "Clear low-light footage. Submit it to meet the Fans’ clear-video requirement.", price: 200, video: true, proof: 'visual' },
  verifiedAudio: { name: 'Verified Cryptid audio', description: "A recording of Cryptid behavior. Submit it as corroborating proof for the Fans.", price: 150, proof: 'audio' },
  verifiedSample: { name: 'Verified Cryptid sample', description: "Preserved Cryptid remains. Submit the sample as corroborating proof for the Fans.", price: 150, proof: 'sample' },
  feed: { name: 'Feeding remains', description: "Remains left after the Cryptid feeds. Collect them or use a sealed sample kit to verify them.", price: 110, collectible: true },
  scat: { name: 'Scat evidence', description: "Evidence left when the Cryptid passes a swallowed tag. Submit the photo for funding.", price: 110 },
  damage: { name: 'Broken equipment', description: "Damage discovered on a deployed device. Submit the photo or collected evidence for funding.", price: 95, collectible: true },
  sighting: { name: 'Cryptid sighting', description: "A confirmed Cryptid sighting. Submit the photo for funding.", price: 180 },
  groupPhoto: { name: '"Me and the boys"', description: "A context photo of the expedition team.", price: 25 },
  gearPhoto: { name: '"The hunt is on"', description: "A context photo of equipment in the field.", price: 25 },
  naturePhoto: { name: '"Nature is beautiful"', description: "A context photo of the surrounding terrain.", price: 25 },
  animalVideo: { name: 'Wildlife footage', description: "Camera footage of ordinary wildlife. Submit it for funding.", price: 25, video: true },
  cryptidVideo: { name: 'Cryptid footage', description: "Standard trail-camera footage of the Cryptid. Submit it for funding.", price: 135, video: true },
  behaviorVideo: { name: 'Cryptid behavior footage', description: "Camera footage of a Cryptid action. Submit it for funding.", price: 220, video: true },
}
