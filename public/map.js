const palettes = {
  w: ['#304730', '#486047', '#142a1d'],
  p: ['#29432f', '#43664b', '#10271a'],
  c: ['#62623a', '#8d8954', '#444922'],
  m: ['#334f47', '#55756b', '#203b39'],
  r: ['#4a5143', '#757764', '#343a31'],
}

const terrainGuide = {
  w: { icon: 'woodland', description: 'Mossy trunks and low brush crowd the narrow trails between the trees.' },
  p: { icon: 'pines', description: 'Tall pines shade a carpet of needles. Their branches muffle sound along the trail.' },
  c: { icon: 'meadow', description: 'Tall grass ripples across an opening in the woods, edged by young trees and brush.' },
  m: { icon: 'marsh', description: 'Reeds and dark pools break up the trail across soft, waterlogged ground.' },
  r: { icon: 'ridge', description: 'Loose slate and jutting stone line the slope. Footprints are hard to follow over exposed rock.' },
}

const landmarkGuide = {
  A4: { short: 'Marsh', icon: 'marsh', description: 'Black pools lie between stands of cattails. A narrow bank skirts the marsh.' },
  B5: { short: 'Ford', icon: 'ford', description: 'Flat stones mark a shallow crossing where the creek narrows.' },
  D1: { short: 'Pines', icon: 'pines', description: 'An old stand of pines keeps the northern trail in shade.' },
  D4: { short: 'Meadow', icon: 'meadow', description: 'A grassy clearing opens at the foot of the ridge, ringed by the woods.' },
  D7: { short: 'Camp', icon: 'camp', description: 'The expedition supply cache sits here. Hunters can trade gear, sell meat, and submit evidence.' },
  F2: { short: 'Ridge', icon: 'ridge', description: 'A shelf of broken slate rises over Blackwater County. The trail follows the shoulder below the crest.' },
}

export function sectorGuide(sector) {
  return landmarkGuide[sector.id] ?? terrainGuide[sector.type]
}

const iconPaths = {
  hunter: 'M3 11h18M6 11l2.5-6h7l2.5 6M8 15c0 3 1.5 5 4 5s4-2 4-5M10 7h4',
  ranger: 'M2.5 13h19M5 13l3-8 4-2 4 2 3 8M8 10h8M8 17h8l-4 4Z',
  biker: 'M21 16a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM10 16a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM6.5 16l4-7 4 7H6.5m8 0 2-10H20M9 9H7',
  prepper: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 8l3-2h6l3 2v12H6ZM9 12h6v5H9ZM6 11H4v6h2m12-6h2v6h-2',
  believer: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12ZM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM12 2.5V4m0 16v1.5',
  footprint: 'M7 16c0-4 2.5-7 5.5-7 2.5 0 4 1.5 3.5 4-.5 2-2.5 1.5-2.5 3.5 0 2.5-1.5 4.5-3.5 4.5S7 19 7 16ZM8 6.5v1m3-2.7v1.6m3-2.1v1.8m3.2-.9v1.5m2 .4V9',
  moth: 'M12 9c-3-4-6.5-6-10-6 0 5 2 9 6 10-3 1-4 3-3 6 3 0 5-2 7-5 2 3 4 5 7 5 1-3 0-5-3-6 4-1 6-5 6-10-3.5 0-7 2-10 6Zm0 0v7m-2-12 2 3 2-3',
  rabbit: 'M9 11 6 5c-1-3 2-4 3-1l3 6 1-7c.3-2.5 3-2 3 .5l-.5 7c3 1 5 3 4.5 6-.5 2.5-3 4-7 4H8l-1-3L4 16l1.5-2.5L9 11Zm6 3h.1M5 16h7',
  deer: 'M9 19 7 13l3 1m4 0 3-1-2 6-3 2-3-2m1-5 2 2 2-2m-5-1L5 9 4 4m5 9L8 7 9 4m-4 5 3-2M15 13l4-4 1-5m-5 9 1-6-1-3m4 5-3-2',
  turkey: 'M8 15C2 12 2 8 5 6l4 5-2-7c3-2 5 0 5 3v4l3-7c3 0 4 2 3 5l-3 4 5-3c3 4 0 7-4 7M7 18c1-4 4-5 6-4l1-2 3 1-3 3v3H9Zm4 1v2m2-2v2',
  camera: 'M4 7h5l1.5-2h3L15 7h5v12H4Zm11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm2-3h1',
  detector: 'M12 5a7 7 0 0 1 7 7M12 2a10 10 0 0 1 10 10m-10 0 5-5m-2 11a6 6 0 1 1-6-10m6 10 2 2M12 12h.1',
  evidence: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1.8 4.2L21 21M8 10l1.5 1.5L12 9',
  lamp: 'M9 15h6m-5 3h4m-3 3h2M8 12a5 5 0 1 1 8 0l-1 3H9Zm4-11v2M3 8h2m14 0h2',
  reflector: 'M4 20 16 4l4 3L8 23ZM3 8h6M4 3l5 2m9 8 3 3',
  snare: 'M12 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0 0v3m-3-9h6m-3-3v6m0 6h5',
  tent: 'M2 20 12 4l10 16ZM12 8v12m0-9-5 9m5-9 5 9M2 20h20',
  broken: 'M4 4h7l1 5-3 3 4 3-2 5H4Zm9 0h7v16h-6m2-11 2-1m-1 6h2',
  woodland: 'M3 19h18M7 19v-5m10 5v-5M3 14l4-8 4 8Zm10 0 4-9 4 9Z',
  pines: 'M12 20v-4m-5 0h10l-3-5h2l-4-7-4 7h2Zm-3 4h16',
  meadow: 'M3 19h18M8 19c0-3-1-5-4-7m8 7v-9m0 5c2-3 5-4 7-4m-4 8c0-2 1-4 3-5M12 4v2M6 6l2 2m8 0 2-2',
  marsh: 'M2 17c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0M3 21c2.5-2 4.5 2 7 0s4.5 2 7 0m-10-6V6m0 5L4 8m10 7V4m0 7 4-4',
  ridge: 'M2 20 9 7l4 7 3-9 6 15ZM6 13l3 2 2-2m3-3 2 2 2-2',
  ford: 'M3 16l3-4h4l2-4h4l3-4h2M3 20c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 8c2-2 4 2 6 0',
  camp: 'M2 19 10 6l8 13H2Zm8-7-4 7m4-7 4 7m4-9h4m-2-2v4m-1 7h3',
}
const iconImages = new Map()

export function mapIcon(type) {
  if (!iconImages.has(type)) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 48
    const context = canvas.getContext('2d')
    context.scale(2, 2)
    context.strokeStyle = '#fff5db'
    context.lineWidth = 1.75
    context.lineJoin = context.lineCap = 'round'
    context.stroke(new Path2D(iconPaths[type]))
    iconImages.set(type, canvas.toDataURL())
  }
  const icon = document.createElement('img')
  icon.className = 'map-icon'
  icon.src = iconImages.get(type)
  icon.alt = ''
  icon.draggable = false
  return icon
}

function tree(context, x, y, size, light, dark) {
  context.fillStyle = '#17261d64'
  context.beginPath()
  context.ellipse(x + size * .27, y + 1, size * .37, size * .14, .23, 0, 2 * Math.PI)
  context.fill()
  context.fillStyle = dark
  context.fillRect(x - size * .04, y - size * .42, size * .1, size * .49)
  for (let tier = 0; tier < 3; tier++) {
    const top = y - size * (1 - tier * .23)
    const width = size * (.21 + tier * .065)
    context.fillStyle = dark
    context.beginPath()
    context.moveTo(x, top)
    context.lineTo(x + width, top + size * .51)
    context.lineTo(x - width, top + size * .51)
    context.fill()
    context.fillStyle = light
    context.beginPath()
    context.moveTo(x, top)
    context.lineTo(x - width, top + size * .51)
    context.lineTo(x + size * .015, top + size * .47)
    context.fill()
  }
}

function drawTerrain(context, space, width, height, random) {
  const [base, light, dark] = palettes[space.type]
  const left = space.x * width
  const top = space.y * height
  const gradient = context.createLinearGradient(left, top, left + width, top + height)
  gradient.addColorStop(0, light)
  gradient.addColorStop(.58, base)
  gradient.addColorStop(1, dark)
  context.fillStyle = gradient
  context.fillRect(left, top, width, height)
  context.save()
  context.beginPath()
  context.rect(left, top, width, height)
  context.clip()
  for (let detail = 0; detail < 145; detail++) {
    context.fillStyle = random() < .53 ? '#d9dc9e19' : '#101f1c28'
    const x = left + random() * width
    const y = top + random() * height
    const length = 1 + random() * 4
    context.fillRect(x, y, length, random() * 1.8 + .4)
  }
  if (space.type === 'w' || space.type === 'p') {
    for (let row = 1; row < 4; row++) {
      for (let column = 0; column < 6; column++) {
        const x = left + (column + random() * .8) * width / 6
        const y = top + (row - .32 + random() * .65) * height / 3
        tree(context, x, y, 9 + random() * 16, random() < .5 ? '#6c86602d' : '#83a16f3f', '#142a1ca0')
      }
    }
  } else if (space.type === 'm') {
    for (let pool = 0; pool < 5; pool++) {
      const x = left + random() * width
      const y = top + random() * height
      const radius = 14 + random() * 17
      context.fillStyle = '#274948ad'
      context.strokeStyle = '#83a79650'
      context.beginPath()
      context.ellipse(x, y, radius, radius * .23, -.22, 0, 2 * Math.PI)
      context.fill()
      context.stroke()
      context.beginPath()
      context.moveTo(x - radius * .54, y + 2)
      context.lineTo(x + radius * .45, y - 1)
      context.stroke()
    }
  } else if (space.type === 'r') {
    for (let rock = 0; rock < 5; rock++) {
      const x = left + (rock / 5 - .06 + random() * .18) * width
      const y = top + (random() * .48 + .46) * height
      const size = 12 + random() * 21
      context.fillStyle = '#30392fa0'
      context.beginPath()
      context.moveTo(x - size, y + 2)
      context.lineTo(x, y - size * .84)
      context.lineTo(x + size * 1.2, y + 5)
      context.fill()
      context.fillStyle = '#a6a38a54'
      context.beginPath()
      context.moveTo(x - size, y + 2)
      context.lineTo(x, y - size * .84)
      context.lineTo(x + size * .23, y - size * .35)
      context.lineTo(x - size * .07, y - size * .43)
      context.fill()
    }
  } else {
    for (let grass = 0; grass < 26; grass++) {
      const x = left + random() * width
      const y = top + random() * height
      context.strokeStyle = '#a9a16b68'
      context.beginPath()
      context.moveTo(x - 2, y - 3)
      context.lineTo(x, y)
      context.lineTo(x + 2, y - 5)
      context.stroke()
    }
  }
  context.restore()
}

export function paintMap(canvas, map) {
  const context = canvas.getContext('2d')
  const width = canvas.width = 980
  const height = canvas.height = 700
  const stepX = width / 7
  const stepY = height / 7
  let seed = 41977
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }

  const spaces = Object.values(map)
  for (const space of spaces) drawTerrain(context, space, stepX, stepY, random)

  // Contours carry between sectors so the terrain reads as one atlas.
  for (let contour = 0; contour < 41; contour++) {
    context.strokeStyle = contour % 4 === 0 ? '#dedcbf27' : '#d6d6b519'
    context.lineWidth = contour % 4 === 0 ? 1.25 : .8
    context.beginPath()
    for (let x = 0; x <= width; x += 6) {
      const y = -74 + contour * 21 + Math.sin(x / 118 + contour * .3) * 14 +
        Math.cos(x / 56 + contour * .23) * 6 + Math.sin(x / 390) * 62 - x * .05
      if (x === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.stroke()
  }

  const riverX = y => 2 * stepX + Math.sin(y / 29) * 8 + Math.sin(y / 71) * 11
  context.beginPath()
  for (let y = 0; y <= height; y += 4) {
    if (y === 0) context.moveTo(riverX(y), y)
    else context.lineTo(riverX(y), y)
  }
  context.lineWidth = 14
  context.strokeStyle = '#233d38'
  context.stroke()
  context.lineWidth = 8
  context.strokeStyle = '#648a7d'
  context.stroke()

  context.lineWidth = 1
  context.strokeStyle = '#d0d8af35'
  for (let index = 1; index < 7; index++) {
    context.beginPath()
    context.moveTo(index * stepX, 0)
    context.lineTo(index * stepX, height)
    context.moveTo(0, index * stepY)
    context.lineTo(width, index * stepY)
    context.stroke()
  }

  const vignette = context.createRadialGradient(width * .53, height * .46, height * .19, width * .53, height * .46, width * .62)
  vignette.addColorStop(0, '#10171000')
  vignette.addColorStop(1, '#101710b5')
  context.fillStyle = vignette
  context.fillRect(0, 0, width, height)

  for (const space of spaces) {
    const x = (space.x + .5) * stepX
    const y = (space.y + .5) * stepY
    for (const direction of ['E', 'S']) {
      const next = map[space.exits[direction]]
      if (!next) continue
      const toX = (next.x + .5) * stepX
      const toY = (next.y + .5) * stepY
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(toX, toY)
      context.lineWidth = 5
      context.strokeStyle = '#16241991'
      context.stroke()
      context.setLineDash([4, 6])
      context.lineWidth = 1.6
      context.strokeStyle = '#e4d09c81'
      context.stroke()
      context.setLineDash([])
      if (space.x === 1 && direction === 'E') {
        const crossing = riverX(y)
        context.fillStyle = '#302e21'
        context.fillRect(crossing - 9, y - 4, 18, 8)
        context.fillStyle = '#c5a777'
        for (let plank = -7; plank <= 7; plank += 3) context.fillRect(crossing + plank, y - 2.5, 2, 5)
      }
    }
    context.fillStyle = '#ebd8a8a5'
    context.beginPath()
    context.arc(x, y, 2.4, 0, 2 * Math.PI)
    context.fill()
  }
}
