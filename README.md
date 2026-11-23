# Cryptid County

A browser game for two or three hunters versus one Cryptid. The Node.js server owns match state and sends each seat only its permitted information.

## Run locally

Requires Node.js 22 or later. There are no npm dependencies to install.

From the game folder in PowerShell, use the launcher to start the server and open the game in your browser.

```powershell
.\game.ps1
```

Use `.\game.ps1 Status` to see the running server's addresses and `.\game.ps1 Stop` to shut it down. Closing the browser tab leaves the server running. Stop ends any active matches. The launcher manages the server it starts and writes logs to `.cryptid-server`.

If the requested port is occupied, the launcher automatically uses a free port. Use the LAN address printed by the launcher for that session.

For a foreground server, use the command below and press Ctrl+C in that terminal to stop it.

```powershell
npm.cmd start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) on the host computer. The server listens on IPv4 LAN interfaces by default. Other devices on the same network can use the LAN URL printed in the terminal and shown in **Settings**. The lobby’s invite link includes the room code. If the computer has multiple LAN addresses, select the address for your group’s network in **Settings**.

`PORT` can override 3000. Set `$env:HOST = '127.0.0.1'` before starting if you want a loopback-only server. A seat reconnects when its tab reloads. Matches live in memory and end when the server stops or restarts.

## Set up an expedition

1. Choose **Host** to create a lobby or **Join** to enter a room code. For one device, choose **Pass and play** and set the player count. The host can type a name for each seat, then choose **Save names** or **Launch expedition**.
2. Each player chooses **Random**, **Hunter**, or **Cryptid** in the lobby. The host can launch once three or four players have joined.
3. The server draws one Cryptid uniformly from the Cryptid volunteers. If that group is empty, it draws from Random players. If everyone prefers Hunter, it draws from the whole group. Everyone else plays Hunter.
4. The assigned Cryptid picks **Sasquatch**, **Bigfoot**, or **Mothman**. Each hunter locks in a distinct class. Round one begins when everyone is ready.

The Settings tab also saves your default callsign and map landmark labels in the current browser.

## Playing

- Select a marked sector to move. The panel below the map shows terrain, connected trails, and known activity for the selected sector.
- Use **Turn** for actions and **End turn** to finish your part of the round. Hunters can alternate actions in any order until each has ended.
- Hunters start with a shared **$2,000** plus the Prepper's bonus if selected. Buy and withdraw gear at base camp.
- Search automatically adds one digital photo per hunter per clue or confirmed sighting. A Search without evidence produces **Me and the boys** with a teammate present, **The hunt is on** with equipment present, or **Nature is beautiful** otherwise. These photos start at $25 and depreciate by category. **Inventory** shows the estimated payout.
- Enter a tile to retrieve waiting trail-camera tapes and photograph broken equipment. A broken device is identified on arrival. Broken-equipment photos and the field notebook show how many rounds ago it broke.
- Use **Site** to trade, submit evidence, or exchange supplies while in camp or at a tent. Site services cost zero actions, even when your action points are gone.
- The hunter map highlights active clues from the newest evidence round. Select a sector to see its surviving clues or use **Field notebook** for the full clue history, alarms, and hunger bearings. The Cryptid has its own private trail and log.
- In a pass-and-play match, choose **Pass device** to hide the map markers and let another player open their seat.

### Hunter classes

| Hunter | Perk |
| --- | --- |
| Park Ranger | Starts with two trail blockades. Deploy or recover one for 1 AP from either endpoint. A blockade closes one ground connection to the Cryptid until recovered or destroyed. A recovered blockade goes back into the Ranger's supply. |
| Trail Biker | Ride two tiles in a straight line for 1 AP once per round when both trails connect. Tile effects apply along the way, and a snare can stop the ride halfway. |
| Prepper | Starts with a loaded netgun, four equipment slots, and $200 added to the shared treasury. |
| True Believer | Identifies false tracks in their own notebook and earns 25% more on photos and videos they personally submit. |
| Trapper | Starts with three snares in one equipment pack. Once per round, deploy a carried snare in the current sector for 0 AP, even after spending both actions. |

### Cryptid abilities

Cryptids start with zero charges. A purple growth marker on the Cryptid map shows a one-use charge pickup. Feeding on it costs one action and gives one charge without changing hunger. Each ability costs one action and one charge.

| Cryptid | Charge pickups | Ability |
| --- | ---: | --- |
| Mothman | 3 | Fly two sectors north, east, south, or west across blocked ground routes, including Ranger blockades. Hazards in the skipped sector are bypassed. The landing sector must be on the map and outside tear gas, and normal arrival rules apply there. |
| Sasquatch | 4 | Reveal deployed hunter equipment in the current sector and its four cardinal neighbors, including across blocked ground routes. |
| Bigfoot | 6 | Set a snare in the current sector. It is hidden from hunters until it triggers. A snared hunter spends one action to escape, which breaks the snare. |

## Prototype decisions

| Area | Default |
| --- | --- |
| Setup and funding | Hunters start at D7 with a base $2,000 shared treasury and their class loadouts. Upkeep is $100 for two hunters and $120 for three. |
| Cryptid | Random northern spawn and zero starting hunger. The Cryptid can end its turn early. Its turn also ends after the second action. |
| Map and visibility | A fixed 7 × 7 map with two-way bypasses at A1–A2, F3–G3, and D5–E5. A hunter snare sends an anonymous alert when it restrains a Cryptid or a live animal. Cryptid equipment memories refresh on entry or through Sasquatch’s ability. |
| Evidence | Footprints expire at age seven, other clues at age twelve. Wetlands use the standard lifetime. Feeding remains and equipment damage can be collected. Each hunter can photograph an event once. Evidence sale multipliers are 100%, 80%, 65%, 50%, 35%, 20%, 10%, then zero. A repeated source applies that curve again to the category price. Photos pay at least $5 each and videos pay at least $25 each after discounts. |
| Meat sales | Base camp pays $60 for the first rabbit, $90 for the first wild turkey, and $125 for the first deer sold by the team. Each species has its own sale count and uses multipliers of 100%, 60%, 30%, 10%, then zero. |
| Gear | Reload, gear recovery, and carcass pickup each cost one action. Dropping a carcass is free before you end your turn. Partial packs merge through storage or recovery. An empty tent can be recovered. An occupied snare cannot be recovered. |
| Detection | Motion detectors cost $45 and give anonymous alerts. Trail cameras reveal live occupants in their tile. A camera-only Cryptid sighting leaves a last-known marker at that tile after the Cryptid leaves or the feed is lost. Cameras record animal or Cryptid entries and observed Cryptid actions. Wildlife tapes pay $25. Unretrieved footage is lost with a destroyed camera. |
| Wildlife | Finite starting populations and species-specific habitat rules. Staying can be preferred. The dominant axis determines a hunger bearing, with east or west winning diagonal ties. A hunter already in the same sector receives a local warning. |
| Snares | A live animal held by a snare stays caught while its wildlife roll says to stay. On its first attempted move it breaks the snare and stays in the same tile for that wildlife turn. Carcasses pass through without triggering snares. |
| Gas and carcasses | Evacuation selects legal destinations uniformly and moves hunters before Cryptid arrival effects. Existing clouds block the Cryptid, and clouds clear after its turn. Dropped carcasses, including those left by a destroyed tent, appear as wildlife on the Cryptid map. The Cryptid can feed on a ground carcass in its sector. |
| Animal tags | Feeding sends no tag alert. A consumed tag has a 40% chance to stay with the remains and a 60% chance to follow the Cryptid through the end of its next turn. A passed tag stays on that tile. The first hunter to enter gets a scat photo and the tag breaks. The Cryptid receives no tag information. |
| Shared turns and rooms | End Turn is final for each hunter within the phase. The server resolves commands in arrival order and applies them atomically. Seats stay reserved on disconnect and can resume with their tab session. There is no turn timer. |

The numbers and map are in [lib/config.js](./lib/config.js). The proposed postgame replay is outside this prototype.

## Verify

```powershell
npm.cmd test
```

The suite exercises role assignment, lobby limits, species selection, LAN addresses, coordinated capture, phase ordering, hidden state, photo estimates, ability charges, alternate routes, feeding, devices, caches, gas, wildlife weights, and competing HTTP requests.

## Title art

[Blackwater forest](./public/blackwater-forest.png) was created with built-in ImageGen.

> Use case: illustration-story. Asset: original landscape key art for the main menu of Cryptid County, a tactical hidden-movement game. Cinematic wide 16:9 composition in the Pacific Northwest at night. Dense, tall, natural fir trunks frame a misty ravine; a massive, barely identifiable Sasquatch silhouette stands mid-distance on the right half, around 75 percent from the left edge, integrated into dark foreground trees, with faint pale haze behind its shoulders. Layers of dark conifer silhouettes, deep forest greens, olive moss, a low muted amber light like a far-off search lantern near the ground, subtle film grain, atmospheric and believable. Leftmost 40 percent is dark, quiet and low-detail for later cream title typography. Palette near-black pine green and muted ochre with no blue neon. Premium cinematic survival mystery game key art with a restrained realistic finish. No text, no graphics, no borders, no interface, no logos, no bright eyes, no gore. Make the forest and silhouette visible in a dark-themed menu.
