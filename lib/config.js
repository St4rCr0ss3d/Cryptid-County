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
  netgun: { name: 'Netgun', size: 2, price: 110, description: 'Two shots. Restrains a confirmed Cryptid in your space.' },
  ammo: { name: 'Spare ammunition', size: 2, price: 35, description: 'Two replacement shots for a netgun.' },
  snare: { name: 'Snares', unit: 'Snare', size: 3, price: 75, deploy: true, description: 'Restrains live wildlife or the Cryptid and gives an anonymous alert.' },
  camera: { name: 'Trail cameras', unit: 'Trail camera', size: 2, price: 70, deploy: true, description: 'Reveals wildlife and the Cryptid in its tile and leaves a last-seen marker after a Cryptid sighting. Visit to retrieve the tapes.' },
  tag: { name: 'Animal tags', size: 3, price: 45, description: 'Tracks a discovered animal. Its signal can persist after feeding.' },
  detector: { name: 'Motion detectors', unit: 'Motion detector', size: 3, price: 45, deploy: true, description: 'Reports movement without identifying its source.' },
  gas: { name: 'Tear gas', size: 1, price: 45, description: 'Evacuates a space and blocks entry for the next two Cryptid turns.' },
  tent: { name: 'Backpack tent', unit: 'Tent', size: 1, price: 85, deploy: true, description: 'Creates a field cache and evidence submission site.' },
  kit: { name: 'Field kit', size: 1, price: 60, description: 'Search also reveals the precise age of each clue.' },
  blockade: { name: 'Trail blockade', unit: 'Trail blockade', size: 1, classGear: true },
}
export const HUNTER_CLASSES = {
  ranger: { name: 'Park Ranger', description: 'Deploy and recover two reusable trail blockades, one per connection. Each costs 1 AP.', blockades: 2 },
  biker: { name: 'Trail Biker', description: 'Ride two connected tiles in a straight line for 1 AP, once each round.' },
  prepper: { name: 'Prepper', description: 'Carry four equipment packs, start with a loaded netgun, and add $200 to the team treasury.', equipment: 4, bonusCash: 200, startingPack: 'netgun' },
  believer: { name: 'True Believer', description: 'Earn 25% more when submitting photos or videos and identify false tracks.', mediaMultiplier: 1.25 },
  trapper: { name: 'Trapper', description: 'Start with three snares. Deploy one carried snare in your sector for 0 AP once each round.', startingPack: 'snare' },
}
export const CRYPTIDS = {
  Sasquatch: { ability: 'Sense equipment', description: 'Reveal hunter equipment here and one tile away in each cardinal direction.', chargePickups: 4 },
  Bigfoot: { ability: 'Set Cryptid snare', description: 'Set a hidden snare in this sector that can restrain a hunter.', chargePickups: 6 },
  Mothman: { ability: 'Fly', description: 'Fly two tiles in a cardinal direction, crossing blocked ground routes.', chargePickups: 3 },
}
// Shorter lists still cover the west, east, and south of the board.
export const CHARGE_GROWTHS = ['B2', 'F3', 'C6', 'D4', 'F5', 'A5']
export function offsetSector(pos, dir, distance = 1) {
  const { x, y } = MAP[pos]
  const [dx, dy] = DIRECTIONS[dir]
  return at(x + dx * distance, y + dy * distance)
}

export const RULES = {
  2: { upkeep: 100 },
  3: { upkeep: 120 },
  startingCash: 2000,
  actions: 2, equipment: 3, cargo: 3, startHunger: 0, maxHunger: 5,
  gasTurns: 2,
  footprintLife: 7, otherClueLife: 12, freshThrough: 2,
  evidenceSaleCurve: [1, .8, .65, .5, .35, .2, .1],
  meatSaleCurve: [1, .6, .3, .1],
  minPhotoPayout: 5,
  minVideoPayout: 25,
  tagRemainsChance: .4,
}
export const SPECIES = {
  rabbit: { name: 'Rabbit', food: 2, price: 60, allowed: 'wpc', preferred: 'wp', spawns: ['B1', 'E3', 'C6', 'G5', 'B3'] },
  turkey: { name: 'Wild turkey', food: 3, price: 90, allowed: 'wpcm', preferred: 'wc', spawns: ['C3', 'D4', 'F5'] },
  deer: { name: 'Deer', food: 5, price: 125, allowed: 'wpcm', preferred: 'cm', spawns: ['B4', 'D3'] },
}
export const EVIDENCE = {
  tracks: { name: 'Footprints', price: 60 },
  feed: { name: 'Feeding remains', price: 110, collectible: true },
  scat: { name: 'Scat evidence', price: 110 },
  damage: { name: 'Broken equipment', price: 95, collectible: true },
  sighting: { name: 'Cryptid sighting', price: 180 },
  groupPhoto: { name: '"Me and the boys"', price: 25 },
  gearPhoto: { name: '"The hunt is on"', price: 25 },
  naturePhoto: { name: '"Nature is beautiful"', price: 25 },
  animalVideo: { name: 'Wildlife footage', price: 25, video: true },
  cryptidVideo: { name: 'Cryptid footage', price: 135, video: true },
  behaviorVideo: { name: 'Cryptid behavior footage', price: 220, video: true },
}
