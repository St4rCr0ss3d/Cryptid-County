import { mapIcon, paintMap, sectorGuide } from './map.js'

const $ = selector => document.querySelector(selector)
const side = $('#side')
const tiles = $('#tiles')
const journal = $('#journal')
const invite = new URL(location.href).searchParams.get('room')?.toUpperCase() ?? ''
const directions = { N: 'North', E: 'East', S: 'South', W: 'West', here: 'Your sector' }
const hunterIcons = { 'Habitat Surveyor': 'ranger', 'Field Mobility Specialist': 'biker', 'Expedition Quartermaster': 'prepper',
  'True Believer': 'believer', 'Live-Capture Technician': 'snare' }
const roleLabels = { random: 'Random', hunter: 'Hunter', cryptid: 'Cryptid' }
const settingsKey = 'cryptid-county-settings'
const settings = { callsign: '', mapLabels: true, lanUrl: '', ...JSON.parse(localStorage.getItem(settingsKey) ?? '{}') }
const loopback = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(location.hostname)
const money = amount => '$' + amount.toLocaleString('en-US')
const stored = sessionStorage.getItem('cryptid-county-seat')
let session = stored ? JSON.parse(stored) : null
if (invite && session?.code !== invite) session = null
let data = null
let map = {}
let gear = {}
let selected = 'D7'
let setupMode = invite ? 'join' : 'create'
let menuTab = 'play'
let lanUrls = []
let controlTab = 'turn'
let journalTab = 'notes'
let targetAction = null
const targetActions = {
  sneak: { label: 'Sneak · 2 AP + 2 movement', prompt: 'Choose a direction to sneak' },
  mislead: { label: 'Leave false tracks · 1 AP', prompt: 'Choose a direction for false tracks' },
  flush: { label: 'Flush wildlife · 2 AP', prompt: 'Choose a direction to flush wildlife' },
  checkCamera: { label: 'Check trail cameras · 2 AP', prompt: 'Choose a trail camera to search' },
}
let siteId
let lobbyNameDraft
let passing = Boolean(session?.passing)
let busy = false
let polling = false
let epoch = 0
let toastTimer

function element(tag, className = '', ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children)
  return node
}

function button(label, callback, className = 'secondary', disabled = false) {
  const node = element('button', className, label)
  node.type = 'button'
  node.disabled = disabled
  node.addEventListener('click', callback)
  return node
}

function setupSignStatic(canvas) {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame
  let interval

  function paint() {
    const pixels = frame.data
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const shade = Math.random() * 255
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade
    }
    context.putImageData(frame, 0, 0)
  }

  function refresh() {
    clearInterval(interval)
    const width = Math.ceil(canvas.clientWidth / 1.5)
    const height = Math.ceil(canvas.clientHeight / 1.5)
    if (!width || !height || document.hidden) return

    if (frame?.width !== width || frame?.height !== height) {
      canvas.width = width
      canvas.height = height
      frame = context.createImageData(width, height)
      frame.data.fill(255)
    }
    paint()
    if (!reducedMotion.matches) interval = setInterval(paint, 120)
  }

  new ResizeObserver(refresh).observe(canvas)
  reducedMotion.addEventListener('change', refresh)
  document.addEventListener('visibilitychange', refresh)
}

function notify(message, error = false) {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.toggle('error', error)
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 4500)
}

async function api(path, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = 'Bearer ' + options.token
  if (options.body) headers['Content-Type'] = 'application/json'
  const response = await fetch('/api' + path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    cache: 'no-store', headers, body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const body = await response.json()
  if (!response.ok) {
    const error = new Error(body.error)
    error.status = response.status
    throw error
  }
  return body
}

function path(endpoint) {
  return '/rooms/' + session.code + '/' + endpoint
}

function saveSession() {
  if (session) sessionStorage.setItem('cryptid-county-seat', JSON.stringify(session))
  else sessionStorage.removeItem('cryptid-county-seat')
}

function setData(next) {
  if (session?.localSeats && next.players) {
    let renamed = false
    for (const seat of session.localSeats) {
      const player = next.players.find(member => member.id === seat.id)
      if (player && player.name !== seat.name) {
        seat.name = player.name
        renamed = true
      }
    }
    if (renamed) saveSession()
  }
  if (JSON.stringify(next) === JSON.stringify(data)) return
  if (next.match?.player.pos !== data?.match?.player.pos) selected = next.match?.player.pos ?? selected
  if (next.match?.player.id !== data?.match?.player.id || next.match?.player.pos !== data?.match?.player.pos ||
    next.match?.round !== data?.match?.round || next.match?.phase !== data?.match?.phase) targetAction = null
  data = next
  render()
}

async function sync() {
  if (!session || busy || polling || passing) return
  const current = epoch
  polling = true
  try {
    const hunterId = data?.match?.role === 'hunter' ? data.match.player.id : null
    const statePath = path('state') + (hunterId ? '?hunterId=' + encodeURIComponent(hunterId) : '')
    const next = await api(statePath, { token: session.token })
    if (current === epoch) setData(next)
  } catch (error) {
    if (current !== epoch) return
    if (error.status === 404 || error.status === 401) {
      session = null
      saveSession()
      data = null
      render()
      notify('Your room has expired or the server restarted.', true)
    }
  } finally {
    polling = false
  }
}

function showSearchDiscoveries(results) {
  if (!results?.cards.length) return
  const dialog = $('#search-discovery')
  $('#search-discovery-title').textContent = 'Findings in ' + results.sector
  $('#search-discovery-cards').replaceChildren(...results.cards.map(card => {
    const art = element('div', 'discovery-art')
    art.dataset.artwork = card.artwork
    art.setAttribute('aria-hidden', 'true')
    return element('figure', 'discovery-card', art,
      element('figcaption', '', card.label))
  }))
  if (!dialog.open) dialog.showModal()
}

async function mutate(endpoint, body) {
  if (busy) return
  busy = true
  epoch++
  try {
    const { searchResults, ...next } = await api(path(endpoint), { token: session.token, method: 'POST', body })
    if (endpoint === 'actions' && next.match?.role === 'hunter') {
      const previous = data?.match?.player.digital?.length ?? 0
      const items = next.match.player.digital.slice(previous)
      const photos = items.filter(item => item.photo)
      const tapes = items.filter(item => item.video)
      const damage = photos.filter(item => Number.isInteger(item.damageAge))
      const scat = photos.filter(item => item.type === 'scat')
      const messages = []
      if (['search', 'checkCamera'].includes(body.type) && photos.length) {
        const value = photos.reduce((sum, photo) => sum + photo.value, 0)
        messages.push(photos.length + (photos.length === 1 ? ' photo saved' : ' photos saved') + ' · ' + money(value) + ' estimated')
      } else if (damage.length === 1) {
        messages.push('Broken equipment photographed · ' + damageAgeText(damage[0].damageAge))
      } else if (damage.length) {
        messages.push(damage.length + ' broken equipment photos saved')
      }
      if (scat.length) messages.push(scat.length === 1 ? 'Scat photo saved · tag broke' : scat.length + ' scat photos saved · tags broke')
      if (tapes.length) messages.push(tapes.length + (tapes.length === 1 ? ' video tape retrieved' : ' video tapes retrieved'))
      if (body.type === 'blockade' && next.match.player.blockades < data?.match?.player.blockades) {
        messages.push('Trail to ' + body.target + ' blockaded.')
      }
      if (messages.length) notify(messages.join(' · '))
    }
    if (endpoint === 'names') lobbyNameDraft = undefined
    if (endpoint === 'actions' && body.type === targetAction) targetAction = null
    setData(next)
    showSearchDiscoveries(searchResults)
    return true
  } catch (error) {
    notify(error.message, true)
    return false
  } finally {
    busy = false
    sync()
  }
}

function send(type, target, extra = {}) {
  const requestId = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
  const { match } = data
  const hunterId = match.role === 'hunter' ? match.player.id : undefined
  return mutate('actions', { type, target, ...extra, hunterId, round: match.round, requestId })
}

function segments(items, active, select) {
  return element('div', 'segments', ...items.map(([value, name]) => {
    const node = button(name, () => select(value), '')
    node.setAttribute('aria-pressed', value === active)
    return node
  }))
}

function sideHeading(kicker, title, description) {
  const header = element('div', 'side-head', element('p', 'eyebrow', kicker), element('h2', '', title))
  if (description) header.append(element('p', '', description))
  return header
}

function badge(label, color) {
  return element('span', 'badge' + (color ? ' ' + color : ''), label)
}

function evidenceValue(value) {
  if (!Number.isFinite(value)) return []
  const tier = value >= 100 ? 'High' : value >= 50 ? 'Mid' : 'Low'
  return [badge(tier + ' · ' + money(value) + ' est.', 'value-' + tier.toLowerCase())]
}

function row(label, ...cells) {
  return element('li', 'row', element('span', '', label), element('div', 'row-group', ...cells))
}

function itemRow(label, description, ...cells) {
  const item = row(label, ...cells)
  if (description) {
    item.firstElementChild.classList.add('item-label')
    item.firstElementChild.append(element('small', 'item-description', description))
  }
  return item
}

function list(rows, empty) {
  return rows.length ? element('ul', 'list', ...rows) : element('p', 'hint', empty)
}

function updateSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings))
  $('#game-screen').classList.toggle('hide-landmarks', !settings.mapLabels)
}

function showSettings() {
  const settingsForm = element('div', 'settings-form')
  const name = element('input')
  name.value = settings.callsign
  name.maxLength = 24
  name.autocomplete = 'nickname'
  name.placeholder = 'Enter a callsign'
  name.addEventListener('input', () => { settings.callsign = name.value; updateSettings() })
  const mapLabels = element('input')
  mapLabels.type = 'checkbox'
  mapLabels.checked = settings.mapLabels
  mapLabels.addEventListener('change', () => { settings.mapLabels = mapLabels.checked; updateSettings() })
  const callsign = element('label', 'setting-field', element('span', '', 'Default callsign'), name)
  const display = element('label', 'setting-toggle', element('span', '', 'Show landmark names on the map'), mapLabels)
  settingsForm.append(callsign, display)
  const network = element('section', 'settings-network',
    element('h3', '', 'LAN connection'),
    element('p', 'hint', 'Players on the same network can open this address.'))
  if (lanUrls.length) {
    const addresses = element('select')
    for (const url of lanUrls) {
      const item = element('option', '', url)
      item.value = url
      addresses.append(item)
    }
    addresses.value = lanUrls.includes(settings.lanUrl) ? settings.lanUrl : lanUrls[0]
    addresses.addEventListener('change', () => { settings.lanUrl = addresses.value; updateSettings() })
    network.append(element('label', 'setting-field', element('span', '', 'Invite address'), addresses))
  } else {
    network.append(element('p', 'hint', 'The server has no available LAN address.'))
  }
  settingsForm.append(network)
  return settingsForm
}

function inviteLink(code) {
  const address = lanUrls.includes(settings.lanUrl) ? settings.lanUrl : lanUrls[0]
  const url = new URL('/', (loopback && address) || location.origin)
  url.searchParams.set('room', code)
  return url.href
}

function inviteControls(room) {
  const code = element('strong', 'room-code', room.code)
  const field = element('input', 'invite-link')
  field.value = inviteLink(room.code)
  field.readOnly = true
  field.setAttribute('aria-label', 'Lobby invite link')
  const copy = button('Copy invite', async () => {
    try {
      await navigator.clipboard.writeText(field.value)
      notify('Invite link copied.')
    } catch {
      field.focus()
      field.select()
      const copied = document.execCommand?.('copy')
      notify(copied ? 'Invite link copied.' : 'Invite link selected. Copy it to share.')
    }
  }, 'secondary compact')
  return element('div', 'invite-controls',
    element('div', 'lobby-code', element('span', 'muted', 'Room code'), code, copy), field)
}

function showSetup() {
  const savedCallsign = $('#callsign')
  if (savedCallsign) {
    if (savedCallsign.value !== settings.callsign) savedCallsign.value = settings.callsign
    return
  }
  side.replaceChildren($('#setup-template').content.cloneNode(true))
  $('#room-code').value = invite
  const callsign = $('#callsign')
  callsign.value = settings.callsign
  callsign.addEventListener('input', () => { settings.callsign = callsign.value; updateSettings() })
  const form = $('#room-form')
  const setMode = mode => {
    setupMode = mode
    const joining = mode === 'join'
    for (const node of side.querySelectorAll('.join-only')) node.hidden = !joining
    for (const node of side.querySelectorAll('.host-options')) node.hidden = joining
    $('#party-size').disabled = joining
    for (const node of side.querySelectorAll('[data-mode]')) node.setAttribute('aria-pressed', node.dataset.mode === mode)
    $('#room-code').required = joining
    $('#room-submit').textContent = joining ? 'Join lobby' : mode === 'local' ? 'Set up local game' : 'Create lobby'
    $('#room-error').hidden = true
  }
  for (const node of side.querySelectorAll('[data-mode]')) node.addEventListener('click', () => setMode(node.dataset.mode))
  setMode(setupMode)

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (busy || !form.reportValidity()) return
    busy = true
    const input = Object.fromEntries(new FormData(form))
    const code = input.code?.trim().toUpperCase()
    const local = setupMode === 'local'
    const submit = $('#room-submit')
    submit.disabled = true
    try {
      const endpoint = setupMode === 'join' ? '/rooms/' + encodeURIComponent(code) + '/seats' : '/rooms'
      const result = await api(endpoint, { body: { ...input, local } })
      session = { code: result.view.code, token: result.token, localSeats: result.localSeats }
      saveSession()
      const url = new URL(location.href)
      if (local) url.searchParams.delete('room')
      else url.searchParams.set('room', session.code)
      history.replaceState(null, '', url)
      setData(result.view)
    } catch (error) {
      const feedback = form.querySelector('#room-error')
      feedback.textContent = error.message
      feedback.hidden = false
    } finally {
      busy = false
      submit.disabled = false
    }
  })
}

function localNameForm(room) {
  if (lobbyNameDraft?.code !== room.code) {
    lobbyNameDraft = { code: room.code, names: room.players.map(player => player.name) }
  }
  const draft = lobbyNameDraft
  const form = element('form', 'local-name-form')
  const namesChanged = () => draft.names.some((name, index) => name !== room.players[index].name)
  const save = element('button', 'secondary full', 'Save names')
  save.disabled = !namesChanged()
  const launch = element('button', 'primary full', 'Launch expedition')
  const fields = room.players.map((player, index) => {
    const input = element('input')
    input.type = 'text'
    input.maxLength = 24
    input.required = true
    input.autocomplete = 'off'
    input.value = draft.names[index]
    input.addEventListener('input', () => {
      draft.names[index] = input.value
      save.disabled = !namesChanged()
    })
    return element('label', 'local-name-field',
      element('span', 'local-name-label',
        'Seat ' + (index + 1) + (player.id === room.player.id ? ' (you)' : ''),
        badge(roleLabels[player.preference], player.preference === 'cryptid' ? 'gold' : null)),
      input)
  })
  form.append(...fields, save, launch)
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (busy) return
    const launchAfterSave = event.submitter === launch
    const changed = namesChanged()
    if (changed && !(await mutate('names', { names: draft.names }))) return
    if (launchAfterSave) await mutate('start')
    else if (changed) {
      render()
      notify('Player names saved.')
    }
  })
  return form
}

function showRoom(room) {
  const count = room.players.length
  const local = Boolean(session.localSeats)
  const matchSize = room.minPlayers === room.maxPlayers ? room.maxPlayers : count
  const seats = room.players.map(player => row(player.name + (room.player.id === player.id ? ' (you)' : ''),
    badge(roleLabels[player.preference], player.preference === 'cryptid' ? 'gold' : null)))
  for (let index = count; !local && index < room.maxPlayers; index++) {
    seats.push(row('Open seat', badge(index < room.minPlayers ? 'Needed to launch' : 'Optional')))
  }
  side.replaceChildren(
    sideHeading(local ? 'Pass and play' : 'Multiplayer', 'Expedition lobby'),
  )
  if (!local) side.append(inviteControls(room))
  const choices = segments(Object.entries(roleLabels), room.player.preference, preference => mutate('preference', { preference }))
  choices.setAttribute('aria-label', 'Your role preference')
  side.append(element('h3', '', 'Your role preference'), choices,
    element('p', 'hint', 'Roles are assigned at launch. Ties are decided at random.'),
    element('p', 'hint', matchSize <= 2 ? '1v1 · One player commands three researchers.' :
      matchSize === 3 ? '2v1 · One researcher per player, with a $600 team grant.' : '3v1 · One researcher per player.'),
    element('h3', 'section-title', 'Players · ' + count + '/' + (local ? count : room.maxPlayers)))
  const faction = room.factions?.[room.faction]
  if (faction) {
    side.append(element('h3', 'section-title', 'Expedition faction'))
    if (room.host) {
      const factions = segments(Object.entries(room.factions).map(([key, details]) => [key, details.name]), room.faction,
        value => mutate('faction', { faction: value }))
      factions.setAttribute('aria-label', 'Expedition faction')
      side.append(factions)
    } else side.append(element('strong', '', faction.name))
    side.append(element('p', 'hint', faction.objective))
  }
  if (local && room.host) {
    side.append(localNameForm(room))
    return
  }
  side.append(list(seats, ''))
  side.append(room.host ? button('Launch expedition', () => mutate('start'), 'primary full', count < room.minPlayers)
    : element('p', 'hint', 'The host can launch once ' + room.minPlayers + ' players have joined.'))
}

function showLoadout(room) {
  const cryptid = room.player.role === 'cryptid'
  const selectedClass = room.classDetails?.[room.player.hunterClass]?.name
  const selection = cryptid ? room.chosenSpecies : selectedClass
  const squad = room.player.hunterClasses
  const canChoose = squad ? squad.length < 3 : !selection && (cryptid || room.classDetails)
  const heading = squad ? 'Expedition squad · ' + squad.length + '/3' :
    canChoose ? (cryptid ? 'Choose your Cryptid' : 'Choose your hunter class') : (selection ?? 'You’re a hunter')
  const message = canChoose && !cryptid ? (squad ? 'Choose three distinct researcher classes.' : 'Each class can be picked by one hunter.') :
    'The first round begins after everyone locks in their choice.'
  side.replaceChildren(sideHeading(room.factions?.[room.faction]?.name ?? 'Roles assigned', heading, message))
  if (canChoose) {
    const buttons = cryptid ? room.speciesOptions.map(species => {
      const details = room.speciesDetails?.[species]
      const option = button('', () => mutate('species', { species }), 'species-option')
      option.append(element('strong', '', species))
      if (details) option.append(element('span', '', details.nightAP + ' AP · ' + details.nightMovement + ' movement at night'))
      if (details) option.append(element('small', '', details.ability + (details.passive ? ' (passive)' : ' · ' + details.abilityCost + ' AP') + ' · ' + details.description))
      if (details?.goal) option.append(element('small', '', 'Personal challenge · ' + details.goal.description))
      if (details?.ultimate) option.append(element('small', '', 'Unlocks ' + details.ultimate.name + ' · ' + details.ultimate.description))
      return option
    }) : Object.entries(room.classDetails).map(([hunterClass, details]) => {
      const claimed = room.players.find(member => member.hunterClass === hunterClass || member.hunterClasses?.includes(hunterClass))
      const option = button('', () => mutate('class', { hunterClass }), 'species-option', Boolean(claimed))
      option.append(element('strong', '', details.name), element('small', '', details.description))
      if (claimed) option.append(element('span', 'badge', 'Taken by ' + claimed.name))
      return option
    })
    side.append(element('div', 'species-list', ...buttons))
  }
  side.append(list(room.players.map(member => {
    const ready = member.role === 'cryptid' ? room.speciesReady :
      (member.classReady ?? (member.hunterClasses ? member.hunterClasses.length === 3 : Boolean(member.hunterClass)))
    const squadNames = member.hunterClasses?.map(key => room.classDetails[key].name).join(', ')
    const choice = squadNames || room.classDetails?.[member.hunterClass]?.name || (ready ? 'Ready' : 'Choosing')
    return row(member.name + (room.player.id === member.id ? ' (you)' : ''), badge(choice, ready ? 'gold' : null))
  }), ''))
}

function showPassScreen() {
  side.replaceChildren(sideHeading('Pass and play', 'Who’s up?', 'Hand the device to the next player before opening their view.'))
  const names = session.localSeats.map((seat, index, seats) => seats.some(other => other !== seat && other.name === seat.name)
    ? seat.name + ' · Seat ' + (index + 1) : seat.name)
  const choices = session.localSeats.map((seat, index) => button(names[index], async () => {
    if (busy) return
    busy = true
    try {
      const next = await api(path('state'), { token: seat.token })
      session.token = seat.token
      session.passing = false
      saveSession()
      passing = false
      controlTab = 'turn'
      siteId = undefined
      setData(next)
    } catch (error) {
      notify(error.message, true)
    } finally {
      busy = false
    }
  }))
  side.append(element('div', 'action-list', ...choices))
}

function mark(icon, label, variant, { last = false, alert = false, tagged = false, self = false, index, description } = {}) {
  const node = element('span', 'marker ' + variant + (last ? ' last' : '') + (alert ? ' alert' : '') +
    (tagged ? ' tagged' : '') + (self ? ' self' : ''), mapIcon(icon))
  if (index != null) node.append(element('small', 'marker-index', String(index + 1)))
  node.setAttribute('aria-label', label)
  node.setAttribute('role', 'img')
  node.title = label
  if (description) node.dataset.description = description
  return node
}

function renderSectorCard(sector, markers, barriers) {
  const card = $('#sector-card')
  if (!sector) return
  const guide = sectorGuide(sector)
  card.hidden = false
  card.dataset.terrain = sector.type
  $('#sector-emblem').replaceChildren(mapIcon(guide.icon))
  $('#sector-code').textContent = sector.id
  const terrain = $('#sector-terrain')
  terrain.textContent = sector.terrain
  terrain.hidden = sector.name === sector.terrain
  $('#sector-title').textContent = sector.name
  $('#sector-description').textContent = guide.description
  const routes = Object.entries(sector.exits).map(([direction, to]) => {
    const gate = barriers.find(device => !device.broken &&
      ((device.pos === sector.id && device.to === to) || (device.to === sector.id && device.pos === to)))
    const status = gate && (gate.remembered ? 'Last known blockade' : 'Cryptid route blocked')
    return element('li', 'sector-route' + (gate ? ' blocked' : ''),
      element('span', 'route-direction', directions[direction]), element('strong', '', to),
      ...(status ? [element('small', '', status)] : []))
  })
  $('#sector-routes').replaceChildren(...routes)
  const contacts = $('#sector-contacts')
  contacts.hidden = !markers.length
  contacts.replaceChildren(...markers.map(marker => {
    const icon = marker.cloneNode(true)
    icon.setAttribute('aria-hidden', 'true')
    const description = marker.dataset.description
    return element('li', '', icon, element('span', '', marker.title,
      ...(description ? [element('small', 'item-description', description)] : [])))
  }))
}

function renderMap(match) {
  if (!Object.keys(map).length) return
  const barriers = match?.devices.filter(device => device.type === 'blockade') ?? []
  const cluesBySector = new Map()
  const hunterMap = match?.role === 'hunter'
  $('#evidence-key').hidden = !hunterMap
  if (hunterMap) {
    for (const clue of match.clues) {
      if (clue.expired || clue.collected) continue
      if (!cluesBySector.has(clue.pos)) cluesBySector.set(clue.pos, [])
      cluesBySector.get(clue.pos).push(clue)
    }
  }
  let selectedMarkers = []
  for (const tile of tiles.children) {
    const sector = map[tile.dataset.sector]
    const { id } = sector
    const isMoving = match?.moves.includes(id)
    const current = match?.player.pos === id
    tile.classList.toggle('reachable', Boolean(isMoving))
    tile.classList.toggle('selected', id === selected)
    tile.classList.toggle('origin', current)
    tile.classList.toggle('gassed', Boolean(match?.gas.includes(id)))
    const units = []
    const localBarriers = barriers.filter(device => device.pos === id || device.to === id)
    const gateLabels = []
    const gates = []
    for (const device of localBarriers) {
      const neighbor = device.pos === id ? device.to : device.pos
      const { x, y } = map[neighbor]
      gateLabels.push((device.broken ? 'Broken blockade' : device.remembered ? 'Last known blockade' : 'Blockaded trail') + ' to ' + neighbor)
      if (sector.x < x || sector.y < y) {
        gates.push(element('span', 'trail-gate ' + (sector.x < x ? 'east' : 'south') +
          (device.broken ? ' broken' : device.remembered ? ' remembered' : '')))
      }
    }
    tile.querySelector('.trail-gates').replaceChildren(...gates)
    for (const hunter of match?.hunters.filter(member => member.pos === id) ?? []) {
      const self = hunter.id === match.player.id
      const icon = hunter.bikePos ? 'hunter' : (hunterIcons[hunter.className] ?? 'hunter')
      units.push(mark(icon, hunter.name + (self ? ' (you)' : '') + (hunter.restrained ? ' (restrained)' : ''), 'hunter',
        { alert: hunter.restrained, self, index: hunter.index }))
    }
    for (const hunter of match?.hunters.filter(member => member.bikePos === id) ?? []) {
      units.push(mark('biker', hunter.name + ' · Parked trail bike', 'device'))
    }
    if (match?.cryptid?.pos === id) {
      const { name, live, restrained } = match.cryptid
      units.unshift(mark(name === 'Mothman' ? 'moth' : 'footprint',
        name + (match.cryptid.tagged ? ' (tagged)' : live ? restrained ? ' (restrained)' : ' (live)' : ' (last known)'), 'cryptid', { last: !live, alert: restrained }))
    }
    for (const animal of match?.animals.filter(item => item.pos === id) ?? []) {
      const name = animal.status === 'alive' ? animal.name : animal.name + ' remains'
      units.push(mark(animal.species, name + (animal.tagged ? ' (tagged)' : animal.live ? '' : ' (last known)'),
        'animal', { last: !animal.live, tagged: animal.tagged }))
    }
    const snares = match?.snares?.filter(snare => snare.pos === id) ?? []
    if (snares.length) {
      const active = snares.some(snare => snare.activated != null)
      units.push(mark('snare', 'Cryptid snare' + (snares.length > 1 ? ' ×' + snares.length : '') +
        (active ? ' (active alert)' : ''), 'cryptid snare', { alert: active }))
    }
    const localDevices = match?.devices.filter(item => item.type !== 'blockade' && item.pos === id) ?? []
    const working = localDevices.filter(device => !device.broken)
    const deviceGroups = new Map()
    for (const device of working) {
      const key = device.type + ':' + (device.activated != null)
      if (!deviceGroups.has(key)) deviceGroups.set(key, [])
      deviceGroups.get(key).push(device)
    }
    for (const devices of deviceGroups.values()) {
      const { type, activated } = devices[0]
      const active = activated != null
      const label = gear[type].unit + (devices.length > 1 ? ' ×' + devices.length : '') +
        (active ? ' (active alert)' : devices[0].remembered ? ' (remembered)' : '')
      const icon = { anchor: 'snare', aerial: 'snare', resonance: 'snare', baitCage: 'snare', voiceTrap: 'snare', lowLight: 'camera', mic: 'detector' }[type] ?? type
      units.push(mark(icon, label, 'device', { last: devices[0].remembered, alert: active, description: gear[type].description }))
    }
    const broken = localDevices.filter(device => device.broken)
    if (broken.length) units.push(mark('broken', 'Broken equipment · ' +
      broken.map(item => gear[item.type].unit).join(', '), 'device broken'))
    const clues = cluesBySector.get(id) ?? []
    if (id === selected) {
      selectedMarkers = [...units, ...clues.map(clue =>
        mark('evidence', clue.name + ' · ' + clue.date, 'evidence'))]
    }
    const mapClues = clues.filter(clue => clue.onMap)
    if (mapClues.length) {
      const label = mapClues.length === 1 ? 'Evidence · ' + mapClues[0].name : mapClues.length + ' recent clues'
      units.unshift(mark('evidence', label, 'evidence'))
    }
    const markers = tile.querySelector('.markers')
    markers.classList.toggle('crowded', units.length > 2)
    tile.classList.toggle('occupied', units.length > 0)
    const visible = units.length > 4
      ? [...units.slice(0, 3), element('span', 'marker more-markers', '+' + (units.length - 3))]
      : units
    markers.replaceChildren(...visible)
    const labels = [...units.map(node => node.title), ...gateLabels]
    tile.setAttribute('aria-label', id + ' · ' + sector.name + (isMoving ? ' · Move here' : '') +
      (current ? ' · Your position' : '') + (labels.length ? ' · ' + labels.join(', ') : ''))
  }
  renderSectorCard(map[selected], selectedMarkers, barriers)
}

function setupMap() {
  for (const sector of Object.values(map)) {
    const node = button('', () => {
      selected = sector.id
      if (!passing && data?.match?.moves.includes(sector.id)) send('move', sector.id)
      renderMap(passing ? null : data?.match)
    }, 'tile')
    node.dataset.sector = sector.id
    const guide = sectorGuide(sector)
    if (guide.short) {
      const emblem = element('span', 'landmark-emblem' + (sector.id === 'D7' ? ' camp' : ''), mapIcon(guide.icon))
      emblem.setAttribute('aria-hidden', 'true')
      node.append(emblem)
      node.append(element('span', 'landmark landmark-full', sector.name),
        element('span', 'landmark landmark-short', guide.short))
    }
    const gates = element('span', 'trail-gates')
    gates.setAttribute('aria-hidden', 'true')
    node.append(gates, element('span', 'markers'))
    tiles.append(node)
  }
  for (const key of document.querySelectorAll('[data-map-icon]')) key.append(mapIcon(key.dataset.mapIcon))
  paintMap($('#landscape'), map)
}

function statsCard(label, value) {
  return element('div', 'stat', element('small', '', label), element('strong', '', value))
}

function showStats(match) {
  const stats = $('#match-stats')
  const caption = $('#phase-caption')
  const subtitle = $('#subtitle')
  if (!match) {
    caption.textContent = passing ? 'Pass and play' : 'Expedition headquarters'
    subtitle.textContent = passing ? 'Select the next player to open their private map.' :
      'A hidden-movement hunt for two to four players.'
    stats.replaceChildren()
    return
  }
  caption.textContent = match.winner ? 'Expedition complete' :
    match.phase === 'hunters' ? 'Day · Expedition turn' : 'Night · Cryptid turn'
  subtitle.textContent = match.role === 'hunter' ?
    (match.faction?.objective ?? 'Capture the Cryptid before expedition funding runs out.') :
    'Outlast expedition funding. Complete your personal challenge to unlock an ultimate.'
  stats.replaceChildren(statsCard('Round', String(match.round)),
    match.role === 'hunter' ? statsCard('Treasury', money(match.cash)) : statsCard('Hunger', match.player.hunger + ' / 5'),
    statsCard('Actions', match.player.maxAP == null ? String(match.player.ap) : match.player.ap + ' / ' + match.player.maxAP),
    ...(match.player.maxMovement == null ? [] : [statsCard('Movement', match.player.movement + ' / ' + match.player.maxMovement)]))
}

function showTurn(match, blockadeOpen) {
  const { player } = match
  const sector = map[player.pos]
  const readyCount = match.hunters.filter(hunter => hunter.ended).length
  const context = element('div', 'context',
    element('strong', '', player.pos + ' · ' + (sector?.name ?? 'County sector')),
    element('p', '', sector ? sector.terrain + ' · ' + Object.keys(sector.exits).map(dir => directions[dir]).join(', ') : ''))
  side.append(context)
  if (match.role === 'cryptid') {
    if (match.goal) {
      side.append(element('h3', '', 'Personal challenge · ' + Math.min(match.goal.progress, match.goal.target) + '/' + match.goal.target),
        element('p', 'hint', match.goal.description))
      for (const item of match.goal.requirements ?? []) {
        side.append(element('p', 'hint', item.label + ' · ' + Math.min(item.progress, item.target) + '/' + item.target))
      }
    }
    if (match.ultimate) {
      const { unlocked, cooldown } = match.ultimate
      const status = !unlocked ? 'Locked' : cooldown ? 'Cooldown · ' + cooldown + (cooldown === 1 ? ' round' : ' rounds') : 'Ready'
      side.append(element('div', 'context', element('strong', '', match.ultimate.name + ' · ' + status),
        element('p', '', match.ultimate.description + ' · 2-round cooldown · ' + match.ultimate.cost + ' AP.')))
    }
    if (player.disguise) side.append(element('p', 'hint', 'Animal form · ' + player.disguise))
    const meter = element('div', 'hunger', ...Array.from({ length: 5 }, (_, index) =>
      element('span', index < player.hunger ? 'filled' : '')))
    meter.setAttribute('aria-label', 'Hunger ' + player.hunger + ' of 5')
    side.append(meter)
    if (player.ability) {
      side.append(element('div', 'context',
        element('strong', '', player.ability.ability + (player.ability.passive ? ' · Passive' : ' · ' + player.ability.abilityCost + ' AP')),
        element('p', '', player.ability.description)))
    }
    if (player.restrained) side.append(element('p', 'warning', 'Restrained. Spend 2 AP to escape.'))
    if (match.devices.some(device => device.type === 'blockade' && !device.broken && !device.remembered)) {
      side.append(element('p', 'hint', 'Blue barriers close the marked trails to ground movement. They stay closed until an expedition specialist recovers them.'))
    }
  } else {
    side.append(element('p', 'hint', readyCount + '/' + match.hunters.length + ' hunters ready · ' + money(match.upkeep) + ' upkeep per round'))
    if (player.restrained) side.append(element('p', 'warning', 'Restrained by a Cryptid snare.'))
    if (match.ready && !player.restrained && match.round === 1 && !player.gear.length && match.sites.some(site => site.camp)) {
      side.append(element('p', 'hint', 'Buy and withdraw your starting gear at base camp.'),
        button('Open camp shop', () => { controlTab = 'site'; showMatch(match) }, 'secondary full shop-link'))
    }
    if (match.actions.some(item => item.type === 'search') && (match.devices.some(device => device.activated != null &&
      (device.pos === player.pos || device.to === player.pos)) ||
      match.snares?.some(snare => snare.pos === player.pos && snare.activated != null))) {
      side.append(element('p', 'hint', 'Search this sector to investigate the alert.'))
    }
    if (match.ready && player.searchedHere) side.append(element('p', 'hint', 'You already searched this sector today.'))
    if (match.warning) side.append(element('p', 'warning', 'Round ' + match.warning.round + ' hunger bearing · ' + directions[match.warning.dir]))
    if (player.blockades) side.append(element('p', 'hint', 'Trail blockades carried · ' + player.blockades))
  }
  if (player.hunterClass === 'biker') {
    side.append(element('p', 'hint', player.bikePos === null ? 'Bike mounted. Dismount to take actions.' : 'Bike parked at ' + player.bikePos))
  }
  if (match.moves.length) side.append(element('p', 'hint', 'Select a highlighted sector on the map to move.'))
  const buttons = match.actions.filter(item => !Object.hasOwn(targetActions, item.type)).map(item =>
    button(item.label, () => send(item.type, item.target),
      ['capture', 'shoot', 'fireRifle', 'preserve', 'escape', 'ability', 'ultimate'].includes(item.type) ? 'primary' : 'secondary'))
  for (const [type, { label }] of Object.entries(targetActions)) {
    if (!match.actions.some(item => item.type === type)) continue
    const hasSignal = match.actions.some(item => item.type === type && item.signal)
    const choose = button(label, () => {
      targetAction = targetAction === type ? null : type
      showMatch(match)
      if (targetAction) side.querySelector('.target-choices button')?.focus()
    }, hasSignal ? 'secondary signal-choice' : 'secondary')
    choose.setAttribute('aria-expanded', String(targetAction === type))
    buttons.push(choose)
  }
  if (buttons.length) side.append(element('div', 'action-list', ...buttons))
  const directional = targetAction && match.actions.filter(item => item.type === targetAction)
  if (directional?.length) {
    const title = targetActions[targetAction].prompt
    const choices = element('div', 'action-list target-choices', ...directional.map(item =>
      button(item.label + (item.signal ? ' · New activity' : ''), () => send(item.type, item.target),
        item.signal ? 'secondary signal-choice' : 'secondary')))
    choices.setAttribute('role', 'group')
    choices.setAttribute('aria-label', title)
    side.append(element('h3', 'section-title', title), choices)
  }
  if (match.blockadeTargets?.length) {
    const routes = Object.entries(sector?.exits ?? {})
    const choices = match.blockadeTargets.map(target => {
      const route = routes.find(([, destination]) => destination === target)
      const label = route ? directions[route[0]] + ' · ' + target : target
      return button(label, () => send('blockade', target), 'secondary compact')
    })
    const picker = element('details', 'blockade-controls',
      element('summary', '', 'Place trail blockade · 1 AP'),
      element('p', 'hint', 'Choose a trail touching this sector. It stays closed to the Cryptid until recovered.'),
      element('div', 'blockade-options', ...choices))
    picker.open = blockadeOpen
    side.append(picker)
  }
  if (!match.ready) {
    side.append(element('p', 'hint', player.ended && match.phase === 'hunters' ? (match.hunters.some(hunter => !hunter.ended && match.controlledHunterIds?.includes(hunter.id)) ?
      'Switch to another researcher to finish their turn.' : 'Waiting for the other hunters to end their turn.') :
      (match.role === 'hunter' ? 'The Cryptid is taking its turn.' : 'The hunters are taking their turn.')))
  }
  if (match.canEnd) side.append(button(match.controlledHunterIds?.length > 1 ? 'End researcher turn' : 'End turn',
    () => send('end'), 'primary full'))
  if (match.role === 'hunter') {
    const roster = match.hunters.map(hunter => row(hunter.name + (hunter.id === player.id ? ' (you)' : ''),
      badge(hunter.pos), ...(hunter.className && hunter.className !== hunter.name ? [badge(hunter.className)] : []), ...(hunter.restrained ? [badge('Restrained', 'danger')] : []),
      badge(hunter.ended ? 'Ready' : hunter.ap + ' AP', hunter.ended ? null : 'gold')))
    side.append(element('h3', 'section-title', 'Hunter team'), list(roster, ''))
  }
}

function packLabel(pack) {
  const definition = gear[pack.type]
  const quantity = ['netgun', 'rifle'].includes(pack.type) ? pack.qty + '/' + definition.size + ' shots' :
    definition.size > 1 ? pack.qty + '/' + definition.size : ''
  return definition.name + (quantity ? ' · ' + quantity : '')
}

function damageAgeText(age) {
  if (age === 0) return 'Broke this round'
  return 'Broke ' + age + (age === 1 ? ' round ago' : ' rounds ago')
}

function showPack(match) {
  const { player } = match
  const gearRows = player.gear.map(pack => itemRow(packLabel(pack), gear[pack.type].description,
    badge(pack.type === 'kit' ? 'Passive' : 'Gear')))
  const roleRows = []
  if (player.bikeDescription) roleRows.push(itemRow('Personal trail bike', player.bikeDescription,
    badge(player.bikePos === null ? 'Mounted' : 'Parked at ' + player.bikePos)))
  if (player.hasBlockadeGear) roleRows.push(itemRow(gear.blockade.name, gear.blockade.description,
    badge(player.blockades + ' carried')))
  const cargoRows = player.cargo.map(item => itemRow(item.name, item.description, ...evidenceValue(item.value)))
  const digitalRows = player.digital.map(item => {
    const type = item.photo ? 'Photo · ' : item.video ? 'Video tape · ' : ''
    const age = item.trackAge ? ' · ' + item.trackAge : Number.isInteger(item.damageAge) ? ' · ' + damageAgeText(item.damageAge) : ''
    return itemRow(type + item.name + age, item.description, ...evidenceValue(item.value))
  })
  if (roleRows.length) side.append(element('h3', '', 'Role equipment'), list(roleRows, ''))
  side.append(element('h3', '', 'Equipment · ' + player.gear.length + '/' + (player.equipmentCapacity ?? 3) + ' slots'), list(gearRows, 'No equipment carried.'),
    element('h3', 'section-title', 'Cargo · ' + player.cargo.length + '/' + (player.cargoCapacity ?? 3) + ' slots'), list(cargoRows, 'No cargo carried.'),
    element('h3', 'section-title', 'Digital evidence · ' + player.digital.length),
    list(digitalRows, 'Search for clues to add photos.'))
  if (digitalRows.length) side.append(element('p', 'hint', 'Estimates reflect the team’s evidence sales so far.'))
}

function showSite(match) {
  if (!match.sites.length) {
    side.append(element('p', 'hint', 'Move to base camp or a deployed tent to use its cache.'))
    return
  }
  const site = match.sites.find(item => item.id === siteId) ?? match.sites[0]
  siteId = site.id
  if (match.sites.length > 1) {
    const select = element('select')
    select.setAttribute('aria-label', 'Select site')
    for (const [index, item] of match.sites.entries()) {
      const option = element('option', '', item.name + (item.camp ? '' : ' ' + (index + 1)))
      option.value = item.id
      option.selected = item.id === site.id
      select.append(option)
    }
    select.addEventListener('change', () => { siteId = select.value; showMatch(match) })
    side.append(select)
  }
  const { player } = match
  const siteReady = match.ready && !player.restrained && player.bikePos !== null
  const atSite = (type, target, withPack) => send(type, target, { site: site.id, with: withPack })
  const transfer = (name, type, target, disabled = false) =>
    button(name, () => atSite(type, target), 'secondary compact', disabled || !siteReady)
  side.append(element('div', 'context', element('strong', '', site.name),
    element('p', '', 'Site services cost zero actions. ' + (site.camp ? 'Shop, sell meat, and submit evidence.' : 'Store supplies and submit evidence.'))))
  const canSubmit = player.digital.length || player.cargo.some(item => !item.species)
  const canSell = player.cargo.some(item => item.species)
  const sales = element('div', 'action-list',
    button('Submit evidence', () => atSite('submit'), 'primary', !siteReady || !canSubmit))
  if (site.camp) sales.append(button('Sell meat', () => atSite('sellMeat'), 'secondary', !siteReady || !canSell))
  side.append(sales, element('h3', '', 'Carried equipment'),
    list(player.gear.map(pack => itemRow(packLabel(pack), gear[pack.type].description, transfer('Deposit', 'storeGear', pack.id))), 'No equipment carried.'))

  const store = []
  for (const [type, definition] of Object.entries(gear)) {
    const price = match.shop ? match.shop[type] : (definition.classGear ? undefined : definition.price)
    const packs = site.gear.filter(pack => pack.type === type)
    if (!packs.length && (!site.camp || price === undefined)) continue
    const count = packs.reduce((sum, pack) => sum + (['netgun', 'rifle'].includes(type) ? 1 : pack.qty), 0)
    const heading = itemRow(definition.name, definition.description, badge(count + ' stored'))
    if (site.camp && price !== undefined) heading.lastElementChild.append(transfer('Buy ' + money(price), 'buy', type, match.cash < price))
    store.push(heading)
    for (const pack of packs) {
      const withdraw = transfer('Withdraw', 'takeGear', pack.id)
      const available = player.gear.map(item => {
        const option = element('option', '', packLabel(item))
        option.value = item.id
        return option
      })
      const swap = element('select', 'swap-choice', element('option', '', 'Swap with…'), ...available)
      swap.setAttribute('aria-label', 'Swap ' + packLabel(pack) + ' with a carried pack')
      swap.disabled = !siteReady || !available.length
      swap.addEventListener('change', () => {
        if (swap.value) atSite('swapGear', pack.id, swap.value)
        swap.value = ''
      })
      store.push(row(packLabel(pack), withdraw, swap))
    }
  }
  side.append(element('h3', 'section-title', site.camp ? 'Camp storage and shop' : 'Tent storage'),
    list(store, 'No equipment stored.'), element('h3', 'section-title', 'Carcasses'),
    list([
      ...player.cargo.filter(item => item.species).map(item => itemRow(item.name + ' · carried', item.description, transfer('Deposit', 'storeCargo', item.id))),
      ...site.cargo.map(item => itemRow(item.name + ' · stored', item.description, transfer('Withdraw', 'takeCargo', item.id, player.cargo.length >= (player.cargoCapacity ?? 3)))),
    ], 'No carcasses here.'))
}

async function selectResearcher(hunterId) {
  if (busy || passing) return
  busy = true
  epoch++
  try {
    const next = await api(path('state') + '?hunterId=' + encodeURIComponent(hunterId), { token: session.token })
    selected = next.match.player.pos
    siteId = undefined
    setData(next)
  } catch (error) {
    notify(error.message, true)
  } finally {
    busy = false
    sync()
  }
}

function showMatch(match) {
  const { player } = match
  const blockadeOpen = side.querySelector('.blockade-controls')?.open ?? false
  const goalWin = match.winReason === 'personalGoal'
  const roleName = match.role === 'hunter' ? (player.className ?? 'Hunter') : match.species
  const playerLabel = roleName === player.name ? player.name : roleName + ' · ' + player.name
  const head = sideHeading(playerLabel,
    match.winner ? (match.winner === 'hunters' ? (match.faction?.outcome ?? 'Cryptid captured') : goalWin ? 'Cryptid goal completed' : 'Expedition exhausted') : 'Field operations')
  side.replaceChildren(head)
  if (match.winner) {
    const message = match.winner === 'hunters' ? (match.faction?.name ?? 'The expedition') + ' won.' :
      goalWin ? (match.goal ? match.goal.description : 'The Cryptid completed its secret objective.') :
      'The treasury ran dry. The Cryptid survived.'
    side.append(element('p', 'muted', message), button('New expedition', () => {
      session = null
      data = null
      passing = false
      selected = 'D7'
      setupMode = 'create'
      menuTab = 'play'
      controlTab = 'turn'
      siteId = undefined
      epoch++
      saveSession()
      history.replaceState(null, '', '/')
      render()
    }, 'primary full'))
    return
  }
  if (match.role === 'hunter') {
    if (match.proof) side.append(element('p', 'hint', 'Verified records submitted: ' + match.proof.count +
      ' · Clear footage ' + (match.proof.visual ? 'submitted' : 'required')))
    if (match.controlledHunterIds?.length > 1) {
      const researchers = match.hunters.filter(hunter => match.controlledHunterIds.includes(hunter.id))
      const choices = segments(researchers.map(hunter => [hunter.id,
        hunter.name + (hunter.ended ? ' · Ready' : ' · ' + hunter.ap + ' AP')]), player.id, selectResearcher)
      choices.setAttribute('aria-label', 'Active researcher')
      side.append(choices)
    }
    side.append(segments([['turn', 'Turn'], ['pack', 'Inventory'], ['site', 'Site']], controlTab,
      tab => { controlTab = tab; showMatch(match) }))
  }
  if (match.role === 'cryptid' || controlTab === 'turn') showTurn(match, blockadeOpen)
  else if (controlTab === 'pack') showPack(match)
  else showSite(match)
}

function showJournal(match) {
  journal.hidden = !match
  if (!match) {
    journal.replaceChildren()
    return
  }
  const hunters = match.role === 'hunter'
  const heading = element('h2', '', hunters ? 'Field notebook' : 'Cryptid trail')
  const tabs = [[ 'notes', hunters ? 'Discoveries' : 'Trail' ], [ 'log', 'Round log' ]]
  if (hunters) tabs.splice(1, 0, ['signals', 'Signals'])
  if (!hunters && journalTab === 'signals') journalTab = 'notes'
  const tabBar = segments(tabs, journalTab, tab => { journalTab = tab; showJournal(match) })
  let rows
  let empty
  if (journalTab === 'log') {
    rows = match.logs.map(item => {
      const entry = row(item.message, element('small', '', 'Round ' + item.round))
      if (item.equipmentAlert) entry.classList.add('equipment-log-alert')
      return entry
    })
    empty = 'No entries yet.'
  } else if (journalTab === 'signals') {
    rows = [
      ...match.devices.filter(item => item.activated != null).map(item =>
        row(gear[item.type].unit + ' alert · ' + item.pos, element('small', '', 'Round ' + item.activated))),
      ...match.snares.filter(snare => snare.activated != null).map(snare =>
        row('Cryptid snare alert · ' + snare.pos, element('small', '', 'Round ' + snare.activated))),
      ...match.warnings.map(item => row(item.name + ' · ' + directions[item.dir], element('small', '', 'Round ' + item.round))),
    ]
    empty = 'No equipment alerts or hunger bearings.'
  } else {
    rows = match.clues.map(item => {
      const status = item.collected ? ' · collected' : item.expired ? ' · expired' : ''
      const when = item.discovered ? ' · found R' + item.discovered : ''
      return row(item.pos + ' · ' + item.name, element('small', '', item.date + when + status))
    })
    empty = hunters ? 'Search a sector to record and share evidence.' : 'Your trail will appear here as you move.'
  }
  journal.replaceChildren(heading, tabBar, list(rows, empty))
}

function render() {
  const match = passing ? null : data?.match
  $('#game-topbar').hidden = !match
  $('#switch-player').hidden = !match || !session?.localSeats
  $('#settings-open').hidden = !match
  $('#lobby-actions').hidden = Boolean(match) || !session?.localSeats || passing || !data
  $('#title-screen').hidden = Boolean(match)
  $('#game-screen').hidden = !match
  const panel = match ? $('#game-screen .dashboard') : $('#menu-content')
  if (side.parentNode !== panel) panel.append(side)
  showStats(match)
  renderMap(match)
  showJournal(match)
  if (match) {
    side.hidden = false
    showMatch(match)
    return
  }
  const loading = session && !data && !passing
  side.hidden = Boolean(loading)
  $('#menu-loading').hidden = !loading
  $('.menu-tabs').hidden = passing
  for (const tab of menuTabs) {
    const active = tab.dataset.menu === menuTab
    tab.setAttribute('aria-selected', active)
    tab.tabIndex = active ? 0 : -1
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active
  }
  if (loading || menuTab !== 'play') return
  if (passing) showPassScreen()
  else if (data?.stage === 'loadout' || data?.stage === 'species') showLoadout(data)
  else if (data) showRoom(data)
  else showSetup()
}

const fieldGuide = $('#guide-content').content
$('#guide-panel').append(fieldGuide.cloneNode(true))
$('#guide-dialog-content').append(fieldGuide.cloneNode(true))
$('#search-discovery').addEventListener('click', () => $('#search-discovery').close())
$('#guide-open').addEventListener('click', () => $('#guide').showModal())
$('#settings-open').addEventListener('click', () => {
  $('#settings-content').replaceChildren(showSettings())
  $('#settings-dialog').showModal()
})
const menuTabs = [...document.querySelectorAll('[data-menu]')]
function selectMenuTab(tab) {
  if (tab.dataset.menu === menuTab) return
  menuTab = tab.dataset.menu
  if (menuTab === 'settings') $('#settings-panel').replaceChildren(showSettings())
  render()
}
for (const tab of menuTabs) tab.addEventListener('click', () => selectMenuTab(tab))
$('.menu-tabs').addEventListener('keydown', event => {
  const index = menuTabs.indexOf(event.target)
  const { length } = menuTabs
  const next = {
    ArrowLeft: (index + length - 1) % length,
    ArrowRight: (index + 1) % length,
    Home: 0,
    End: length - 1,
  }[event.key]
  if (index < 0 || next === undefined) return
  event.preventDefault()
  menuTabs[next].focus()
  selectMenuTab(menuTabs[next])
})
function passDevice() {
  if (busy) return
  epoch++
  passing = true
  menuTab = 'play'
  session.passing = true
  saveSession()
  data = null
  selected = 'D7'
  $('#toast').hidden = true
  render()
}
$('#switch-player').addEventListener('click', passDevice)
$('#lobby-pass').addEventListener('click', passDevice)
setupSignStatic($('.sign-static'))
updateSettings()
render()
const [terrain, network] = await Promise.allSettled([api('/map'), api('/network')])
if (terrain.status === 'fulfilled') {
  map = terrain.value.map
  gear = terrain.value.gear
  setupMap()
} else {
  notify('The field map could not load. Refresh to retry.', true)
}
if (network.status === 'fulfilled') {
  lanUrls = network.value.lanUrls
  if (menuTab === 'settings') $('#settings-panel').replaceChildren(showSettings())
}
render()
sync()
setInterval(sync, 650)
