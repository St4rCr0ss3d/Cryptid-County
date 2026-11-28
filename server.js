import { createServer } from 'node:http'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createMatch, act, RuleError } from './lib/game.js'
import { matchView, searchView } from './lib/view.js'
import { MAP, GEAR, SIZE, CRYPTIDS, HUNTER_CLASSES, FACTIONS, classesFor } from './lib/config.js'

const alphabet = 'ACDEFGHJKMNPQRTUVWXY346789'
const speciesOptions = Object.keys(CRYPTIDS)
const preferences = ['random', 'hunter', 'cryptid']
const minPlayers = 2
const maxPlayers = 4
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/map.js': ['map.js', 'text/javascript; charset=utf-8'],
  '/search-discoveries.png': ['search-discoveries.png', 'image/png'],
  '/blackwater-forest.png': ['blackwater-forest.png', 'image/png'],
}
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function makePlayer(name) {
  return { name, preference: 'random', id: randomUUID(), token: randomBytes(24).toString('base64url'), requests: new Set() }
}

function publicPlayer({ id, name, preference, role, hunterClass, hunterClasses }) {
  return { id, name, preference, role, hunterClass, hunterClasses }
}

function localPlayer(player) {
  return { id: player.id, name: player.name, token: player.token }
}

export function assignRoles(players, chooseIndex = randomInt) {
  const volunteers = players.filter(player => player.preference === 'cryptid')
  const flexible = players.filter(player => player.preference === 'random')
  const candidates = volunteers.length ? volunteers : flexible.length ? flexible : players
  const cryptid = candidates[chooseIndex(candidates.length)]
  for (const player of players) player.role = player === cryptid ? 'cryptid' : 'hunter'
}

export function lanUrls(address, interfaces = networkInterfaces()) {
  if (!address || typeof address !== 'object') return []
  const physical = /^(wi-?fi|wireless|wl[ap]|ethernet|eth|en[0-9ops]|local area connection)/i
  const adapters = Object.entries(interfaces).sort(([left], [right]) => Number(physical.test(right)) - Number(physical.test(left)))
  const external = adapters.flatMap(([, entries]) => entries ?? []).filter(entry => entry.family === 'IPv4' && !entry.internal)
  const addresses = address.address === '0.0.0.0' || address.address === '::'
    ? external.map(entry => entry.address)
    : external.filter(entry => entry.address === address.address).map(entry => entry.address)
  return [...new Set(addresses)].map(ip => 'http://' + ip + ':' + address.port)
}

function playerName(name, fallback) {
  return typeof name === 'string' ? name.trim().replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 24) || fallback : fallback
}

function view(room, player, hunterId) {
  if (room.match) return { code: room.code, match: matchView(room.match, player.id, hunterId) }
  const isCryptid = player.role === 'cryptid'
  return {
    code: room.code, stage: room.stage, player: publicPlayer(player), host: room.host === player.id,
    minPlayers, maxPlayers, faction: room.faction, factions: FACTIONS, players: room.players.map(member => {
      if (!isCryptid || member.role !== 'hunter') return publicPlayer(member)
      const { hunterClass, hunterClasses, ...visible } = publicPlayer(member)
      return { ...visible, classReady: hunterClasses ? hunterClasses.length === 3 : Boolean(hunterClass) }
    }),
    ...(room.stage === 'loadout' ? {
      speciesReady: Boolean(room.species),
      ...(isCryptid
        ? { speciesOptions, speciesDetails: CRYPTIDS, chosenSpecies: room.species }
        : { classDetails: classesFor(room.faction) }),
    } : {}),
  }
}

function finishLoadout(room) {
  if (!room.species || room.players.some(player => player.role === 'hunter' &&
    (player.hunterClasses ? player.hunterClasses.length !== 3 : !player.hunterClass))) return
  const units = room.players.flatMap(player => {
    if (!player.hunterClasses) return [publicPlayer(player)]
    return player.hunterClasses.map((hunterClass, index) => ({
      ...publicPlayer(player), id: index === 0 ? player.id : randomUUID(), ownerId: player.id,
      name: HUNTER_CLASSES[hunterClass].name, hunterClass,
    }))
  })
  room.match = createMatch(units, room.species, Math.random, room.faction)
  room.stage = 'match'
}

async function bodyOf(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 8192) throw new HttpError(413, 'Request is too large.')
  }
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    throw new HttpError(400, 'Expected a JSON object.')
  }
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}

export function createGameServer() {
  const rooms = new Map()
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'")
    try {
      const url = new URL(request.url, 'http://localhost')
      const method = request.method
      if (method === 'GET' && Object.hasOwn(assets, url.pathname)) {
        const [name, contentType] = assets[url.pathname]
        const data = await readFile(new URL('./public/' + name, import.meta.url))
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' })
        response.end(data)
        return
      }
      if (method === 'GET' && url.pathname === '/api/map') {
        json(response, 200, { map: MAP, size: SIZE, gear: GEAR })
        return
      }
      if (method === 'GET' && url.pathname === '/api/network') {
        json(response, 200, { lanUrls: lanUrls(server.address()) })
        return
      }
      if (method === 'POST' && url.pathname === '/api/rooms') {
        const body = await bodyOf(request)
        const host = makePlayer(playerName(body.name, 'Player 1'))
        let code
        do {
          code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
        } while (rooms.has(code))
        const room = { code, host: host.id, players: [host], local: body.local === true, faction: 'researchers', stage: 'lobby', match: null }
        if (room.local) {
          const requested = Number(body.playerCount)
          const count = Number.isInteger(requested) && requested >= minPlayers && requested <= maxPlayers ? requested : 3
          while (room.players.length < count) room.players.push(makePlayer('Player ' + (room.players.length + 1)))
        }
        rooms.set(code, room)
        const localSeats = room.local ? room.players.map(localPlayer) : undefined
        json(response, 201, { token: host.token, localSeats, view: view(room, host) })
        return
      }
      const route = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(seats|state|preference|names|faction|start|species|class|actions)$/)
      const room = route && rooms.get(route[1])
      if (!room) throw new HttpError(404, 'Room not found. Check the room code.')
      const endpoint = route[2]
      if (method === 'POST' && endpoint === 'seats') {
        const body = await bodyOf(request)
        if (room.stage !== 'lobby') throw new HttpError(409, 'This expedition has already launched.')
        if (room.local || room.players.length >= maxPlayers) throw new HttpError(409, 'This lobby is full.')
        const player = makePlayer(playerName(body.name, 'Player ' + (room.players.length + 1)))
        room.players.push(player)
        json(response, 201, { token: player.token, view: view(room, player) })
        return
      }
      const token = request.headers.authorization?.match(/^Bearer ([\w-]+)$/)?.[1]
      const player = token && room.players.find(seat => seat.token === token)
      if (!player) throw new HttpError(401, 'This room requires a valid seat.')
      if (method === 'GET' && endpoint === 'state') {
        json(response, 200, view(room, player, url.searchParams.get('hunterId')))
      } else if (method === 'POST' && endpoint === 'names') {
        const { names } = await bodyOf(request)
        if (!room.local || room.host !== player.id) throw new HttpError(403, 'Only the Pass and play host can rename seats.')
        if (room.stage !== 'lobby') throw new HttpError(409, 'Names are locked after the expedition launches.')
        if (!Array.isArray(names) || names.length !== room.players.length) {
          throw new HttpError(400, 'Enter a name for every seat.')
        }
        const cleaned = names.map(name => playerName(name, '').trim())
        if (cleaned.some(name => !name)) throw new HttpError(400, 'Enter a name for every seat.')
        room.players.forEach((seat, index) => { seat.name = cleaned[index] })
        json(response, 200, view(room, player))
      } else if (method === 'POST' && endpoint === 'preference') {
        const { preference } = await bodyOf(request)
        if (room.stage !== 'lobby') throw new HttpError(409, 'Roles have already been assigned.')
        if (!preferences.includes(preference)) throw new HttpError(400, 'Choose Random, Hunter, or Cryptid.')
        player.preference = preference
        json(response, 200, view(room, player))
      } else if (method === 'POST' && endpoint === 'faction') {
        const { faction } = await bodyOf(request)
        if (room.host !== player.id) throw new HttpError(403, 'Only the host chooses the expedition faction.')
        if (room.stage !== 'lobby') throw new HttpError(409, 'The expedition faction is locked.')
        if (typeof faction !== 'string' || !Object.hasOwn(FACTIONS, faction)) throw new HttpError(400, 'Choose a listed faction.')
        room.faction = faction
        json(response, 200, view(room, player))
      } else if (method === 'POST' && endpoint === 'start') {
        if (room.host !== player.id) throw new HttpError(403, 'Only the host can start the expedition.')
        if (room.players.length < minPlayers) throw new HttpError(409, 'At least two players are needed to launch.')
        if (room.stage === 'lobby') {
          assignRoles(room.players)
          if (room.players.length === 2) room.players.find(member => member.role === 'hunter').hunterClasses = []
          room.stage = 'loadout'
        }
        json(response, 200, view(room, player))
      } else if (method === 'POST' && endpoint === 'species') {
        const { species } = await bodyOf(request)
        if (room.stage !== 'loadout' || room.species) throw new HttpError(409, 'The Cryptid selection is closed.')
        if (player.role !== 'cryptid') throw new HttpError(403, 'Only the assigned Cryptid can choose a species.')
        if (!speciesOptions.includes(species)) throw new HttpError(400, 'Choose a listed Cryptid.')
        room.species = species
        finishLoadout(room)
        json(response, 200, view(room, player))
      } else if (method === 'POST' && endpoint === 'class') {
        const { hunterClass } = await bodyOf(request)
        if (room.stage !== 'loadout') throw new HttpError(409, 'The hunter class selection is closed.')
        if (player.role !== 'hunter') throw new HttpError(403, 'Only hunters can choose a hunter class.')
        if (typeof hunterClass !== 'string' || !Object.hasOwn(HUNTER_CLASSES, hunterClass) || HUNTER_CLASSES[hunterClass].faction !== room.faction) {
          throw new HttpError(400, 'Choose a listed hunter class.')
        }
        if (player.hunterClasses) {
          if (!player.hunterClasses.includes(hunterClass)) {
            if (player.hunterClasses.length === 3) throw new HttpError(409, 'Your squad is already locked in.')
            player.hunterClasses.push(hunterClass)
          }
        } else {
          if (player.hunterClass && player.hunterClass !== hunterClass) throw new HttpError(409, 'Your class is already locked in.')
          if (room.players.some(member => member !== player && member.hunterClass === hunterClass)) {
            throw new HttpError(409, 'Another hunter already picked that class.')
          }
          player.hunterClass = hunterClass
        }
        finishLoadout(room)
        json(response, 200, view(room, player))
      } else if (method === 'POST' && endpoint === 'actions') {
        const command = await bodyOf(request)
        if (!room.match) throw new HttpError(409, 'The expedition has not started.')
        // No awaits after this point. Validations and mutations resolve in one event loop turn.
        const requestId = typeof command.requestId === 'string' && command.requestId.length <= 64 ? command.requestId : null
        let findings
        if (!requestId || !player.requests.has(requestId)) {
          if (command.round !== room.match.round) throw new HttpError(409, 'That round has ended. Try again in the current round.')
          findings = act(room.match, player.id, command)
          if (requestId) player.requests.add(requestId)
          if (player.requests.size > 100) player.requests.delete(player.requests.values().next().value)
        }
        const result = view(room, player, command.hunterId)
        if (findings) result.searchResults = searchView(result.match, findings)
        json(response, 200, result)
      } else {
        throw new HttpError(404, 'Unknown endpoint.')
      }
    } catch (error) {
      const status = error instanceof RuleError ? 409 : (error.status ?? 500)
      if (status === 500) console.error(error)
      json(response, status, { error: status === 500 ? 'The server could not complete the request.' : error.message })
    }
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000)
  const host = process.env.HOST ?? '0.0.0.0'
  const server = createGameServer()
  server.listen(port, host, () => {
    const address = server.address()
    const local = host === '0.0.0.0' ? '127.0.0.1' : host.includes(':') ? '[' + host + ']' : host
    console.log('Cryptid County · This computer: http://' + local + ':' + address.port)
    for (const url of lanUrls(address)) console.log('Cryptid County · Same network: ' + url)
  })
}
