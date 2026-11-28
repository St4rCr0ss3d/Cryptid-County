# Cryptid County

A browser game for two to four players, with one player controlling the Cryptid. The Node.js server owns match state and sends each seat only its permitted information.

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
2. The host chooses **Researchers**, **Hunters**, or **Fans** for the expedition. Each player chooses **Random**, **Hunter**, or **Cryptid** in the lobby. The host can launch with two to four players. With two players (1v1), the expedition player controls three researchers and switches between them during Day. With three (2v1), the two researchers get a $600 team support grant. With four (3v1), each of the three researchers has their own player.
3. The server draws one Cryptid uniformly from the Cryptid volunteers. If that group is empty, it draws from Random players. If everyone prefers Hunter, it draws from the whole group. Everyone else plays Hunter.
4. The assigned Cryptid picks **Sasquatch**, **Mothman**, **Jersey Devil**, **Chupacabra**, or **Mimic**. The expedition locks in a distinct class for each researcher. Round one begins when everyone is ready.

The Settings tab also saves your default callsign and map landmark labels in the current browser.

## Playing

- Select a marked sector to spend one movement point and move without spending AP. The panel below the map shows terrain, connected trails, and known activity for the selected sector.
- Use **Turn** for actions and **End turn** to finish your part of the round. During Day, each hunter gets 3 AP and 2 movement points and can alternate actions with teammates. A hunter automatically ends their turn when both budgets run out. Wildlife waits until every hunter has ended. Wildlife moves at dusk. During Night, the Cryptid gets species-specific action and movement points and can sabotage equipment or leave false tracks. The expedition pays upkeep once per cycle. Hunters learn the Cryptid’s species on their first confirmed sighting or when the match ends.
- Hunters start with a shared **$2,000** plus the 2v1 support grant and the Prepper's bonus when applicable. Buy and withdraw gear at base camp.
- Search shows illustrated discovery cards to the searching player when it turns up evidence or wildlife. Click or tap anywhere to dismiss them.
- Each researcher can search a sector once per Day, including researchers controlled by the same player. A camera check uses the deployer’s Search for that sector. Search saves saleable photos of evidence that has yet to be photographed using AP. Selling a Cryptid photo identifies its species in the log and names its tracks for the whole team. Cryptid tracks show their direction when known. Wildlife tracks help scout animal movement and produce no payout.
- Search an alerted sector to investigate and clear its alerts. An animal still held in a snare triggers a new alert at its next wildlife turn.
- Enter a tile to retrieve waiting trail-camera tapes and photograph broken equipment. A broken device is identified on arrival. Broken-equipment photos and the field notebook show how many rounds ago it broke.
- Use **Site** to trade, submit evidence, or exchange supplies while in camp or at a tent. Site services cost zero actions, even when your action points are gone.
- The hunter map highlights active clues from the newest evidence round. Select a sector to see its surviving clues or use **Field notebook** for the full clue history, alarms, and hunger bearings. The Cryptid has its own private trail and log.
- In a pass-and-play match, choose **Pass device** to hide the map markers and let another player open their seat.

### Expedition factions

The host picks one faction for the team. Each faction has six roles. Players choose a distinct role for each researcher they control.

| Faction | Objective | Exclusive store gear |
| --- | --- | --- |
| Researchers | Confirm and restrain the Cryptid, then spend 2 AP in its sector to capture it alive. | Sasquatch net launcher and anchored snare, Mothman landing net, Jersey Devil resonance snare, Chupacabra bait cage, Mimic voiceprint snare, animal tags |
| Hunters | Wound a confirmed Cryptid and land a finishing shot. Each unit can fire once per Day. Ordinary rifle shots cost 2 AP. | Hunting rifle and ammunition, rangefinder, blood-trail kit |
| Fans | Submit two verified records from separate events at a camp or tent. At least one must be clear video. | Low-light video camera, directional microphone, sealed sample kit |

Trail cameras, tents, motion detectors, field kits, wildlife snares, and tear gas are shared. Researchers can tag live snared animals. Hunters can harvest snared wildlife or spend one rifle round to hunt a free animal. Fans and Researchers cannot hunt. Authentic tracks reveal a species pattern when examined with a field kit or a role that can read precise clues. Standard cameras and ordinary photos help track the Cryptid and earn funding. Fans need low-light footage, audio from recorded Cryptid behavior, or Cryptid feeding remains preserved with a sample kit to make progress toward proof.

| Faction | Roles |
| --- | --- |
| Researchers | Habitat Surveyor closes two trails. Field Mobility Specialist can mount a personal off-road bike for 4 movement and must dismount to take actions. Mounting or dismounting costs 1 AP. Expedition Quartermaster brings a loaded net launcher, extra gear space, and funding. Live-Capture Technician brings an anchored snare and one free trap deployment each Day. Field Biologist reads precise track evidence and brings animal tags. Field Safety Officer brings tear gas and can use it once per Day for 0 AP. |
| Hunters | Marksman fires for 1 AP and brings a rangefinder. Blood Tracker reads false and authentic tracks and brings a blood-trail kit. Blood shows the real direction of wounded ground movement even through sneaking or false footprints. Mothman’s flight breaks the trail. Outfitter carries extra gear, ammunition, and funds. Ridge Runner deploys one detector for free each Day. Backcountry Warden funnels the Cryptid with a blockade and tear gas. Armorer starts with a rifle and receives a rifle and ammunition discount. |
| Fans | True Believer spots fake tracks and earns more from submitted media. Night Videographer brings a low-light camera and deploys one camera for free each Day. Acoustic Surveyor brings microphones and deploys one for free each Day. Sample Naturalist reads precise clues and carries extra samples. Trail Vlogger brings a trail camera and photographs one clue other than footprints or a Cryptid sighting for free each Day. Field Producer brings a tent and funding and buys tents and low-light cameras at a discount. |

### Cryptid abilities

Active signature powers cost AP. Sasquatch’s signature sense is free and always on. Chupacabra starts Night with 4 movement. The other species start with 3. A private challenge unlocks a one-use ultimate that costs the species’s full Night AP allowance. The Cryptid wins by surviving until expedition funding runs out.

- **Sneak** costs 2 AP and 2 movement to cross a legal trail without leaving footprints. Cameras, observers, and snares still work.
- **Forage** costs 2 AP and has a 20% chance to reduce hunger by one. You can attempt it once per Night in woodland or pine forest.
- **Flush wildlife** costs 2 AP to drive free living animals in your sector into a connected sector. They can trigger detection devices and snares there.

- **Set hidden snare** costs 3 AP. Every species may set one per Night, with a maximum of one per sector. Cryptid snares catch expedition members only. A snare removes remaining movement for that turn, even after escape. Escaping costs 2 AP. Mounted bikes pass over Cryptid snares without setting them off. Dismounting onto a snare can trigger it.

| Cryptid | Night AP | Signature power | Personal challenge |
| --- | ---: | --- | --- |
| Sasquatch | 9 | **Sense equipment**, passive. Detect equipment in its sector and the eight surrounding sectors, including diagonals and across blocked trails. | Destroy five expedition devices across at least three sectors. |
| Mothman | 6 | **Fly**, 4 AP. Fly two sectors in a straight line over blocked trails. | Fly into four different named landmarks over at least three Nights. |
| Jersey Devil | 7 | **Terrifying shriek**, 5 AP. Frighten members here or in a connected sector. Affected members start the next Day with 2 AP. | Frighten members six times across at least three Nights. Each member counts once per Night. |
| Chupacabra | 8 | **Lure wildlife**, 4 AP. Pull a free animal from a connected sector into suitable habitat in your sector. | Feed on five animals over at least three Nights, including rabbit, wild turkey, and deer. |
| Mimic | 8 | **Phantom Trigger**, 5 AP. Spoof an alert from random deployed equipment outside your sector and its eight neighbors. | Get four spoofed alerts investigated by at least two different expedition members. |

A Phantom Trigger alert counts when an expedition member searches the device’s sector the following Day. A voiceprint snare restrains the Mimic if it uses Phantom Trigger from the trapped sector. Challenges and their progress are visible only to the Cryptid. After using an ultimate, the Cryptid waits two full rounds before using it again.

| Cryptid | Ultimate | AP | Effect |
| --- | --- | ---: | --- |
| Sasquatch | Rampage | 9 | Destroy expedition devices in the current and eight surrounding sectors. Trail blockades survive. |
| Mothman | Long Flight | 6 | Fly four sectors in a cardinal direction. Landing hazards still apply. |
| Jersey Devil | Countywide Shriek | 7 | Every expedition member starts the next Day with 1 AP. |
| Chupacabra | Predator’s Surge | 8 | Reset hunger to zero and gain three more movement this Night. |
| Mimic | Animal Form | 8 | Become a rabbit, wild turkey, or deer through the next two Days. A snared disguise can be tagged, and a rifle shot breaks the disguise and ends the shooter’s turn. |

## Prototype decisions

| Area | Default |
| --- | --- |
| Setup and funding | Hunters start at D7 with a base $2,000 shared treasury and their class loadouts. Two-researcher teams receive an additional $600. Upkeep is $100 for two hunters and $120 for three. |
| Cryptid | Random northern spawn and zero starting hunger. The Cryptid can move and act in any order and selects End turn when finished. Ordinary travel costs one movement point per connected sector. Mothman and Chupacabra cannot leave false tracks. The Blood Tracker and True Believer label genuine and false Cryptid tracks by species. |
| Map and visibility | A fixed 7 × 7 map with two-way bypasses at A1–A2, F3–G3, and D5–E5. Wildlife snares and species-specific capture traps send alerts when triggered. Trail blockades stay closed until recovered by an expedition specialist. Cryptid equipment memories refresh on entry. Sasquatch also senses adjacent and diagonal sectors passively. |
| Evidence | Footprints can be found for four days. Photos label them Fresh (including one-round-old tracks), 2 rounds ago, or Cold. Other clues expire at age twelve. In-person Search and direct photos of footprints or the Cryptid cost 1 AP. Wetlands use the standard lifetime. Feeding remains and equipment damage can be collected. Once a researcher spends AP to photograph a clue, the team cannot take another photo of that clue. This also applies to photos saved by Search. Evidence sale multipliers are 100%, 80%, 65%, 50%, 35%, 20%, 10%, then zero. A repeated source applies that curve again to the category price. Photos pay at least $5 each and videos pay at least $25 each after discounts. |
| Meat sales | Base camp pays $60 for the first rabbit, $90 for the first wild turkey, and $125 for the first deer sold by the team. Each species has its own sale count and uses multipliers of 100%, 60%, 30%, 10%, then zero. |
| Gear | Reload, gear recovery, and carcass pickup each cost one action. Dropping a carcass is free before you end your turn. Partial packs merge through storage or recovery. An empty tent can be recovered. An occupied snare cannot be recovered. |
| Detection | Motion detectors cost $45 and give anonymous alerts. Activated gear has a red outline and signal log entries appear in red. Cameras record silently. Only the unit that deployed a camera can search its sector remotely for 2 AP, one camera at a time. This counts as that player’s Search for the sector and can reveal evidence or clear alerts. Camera choices with unreviewed activity are red. A camera sighting becomes a last-known marker when Night starts or the feed is lost. Recordings still require an in-person visit. Cameras record animal or Cryptid entries and observed Cryptid actions. Wildlife tapes pay $25. Unretrieved footage is lost with a destroyed camera. |
| Wildlife | Moving animals, including the Mimic in Animal Form, leave species-specific tracks. Finite starting populations and species-specific habitat rules. Staying can be preferred. The dominant axis determines a hunger bearing, with east or west winning diagonal ties. A hunter already in the same sector receives a local warning. |
| Snares | On each subsequent wildlife turn, turkeys have a 25% chance to break free, deer always break free on their first wildlife turn, and rabbits stay caught. Animals that break out stay in the sector for that wildlife turn. Carcasses do not trigger snares. |
| Gas and carcasses | Evacuation selects legal destinations uniformly and moves hunters before Cryptid arrival effects. Existing clouds block the Cryptid, and clouds clear after its turn. Dropped carcasses, including those left by a destroyed tent, appear as wildlife on the Cryptid map. The Cryptid can feed on a ground carcass in its sector. |
| Animal tags | Only Researchers can buy tags and tag live snared wildlife. Feeding sends no tag alert. A consumed tag has a 40% chance to stay with the remains and a 60% chance to follow the Cryptid through the end of its next turn. A passed tag stays on that tile. The first hunter to enter gets a scat photo and the tag breaks. The Cryptid receives no tag information. |
| Shared turns and rooms | End Turn is final for each hunter within the phase. The server resolves commands in arrival order and applies them atomically. Seats stay reserved on disconnect and can resume with their tab session. There is no turn timer. |

The numbers and map are in [lib/config.js](./lib/config.js). The proposed postgame replay is outside this prototype.

## Verify

```powershell
npm.cmd test
```

The suite exercises role assignment, lobby limits, species selection, LAN addresses, coordinated capture, phase ordering, hidden state, photo estimates, signature and ultimate costs, alternate routes, feeding, devices, caches, gas, wildlife weights, and competing HTTP requests.

## Title art

[Blackwater forest](./public/blackwater-forest.png) was created with built-in ImageGen.

> Use case: illustration-story. Asset: original landscape key art for the main menu of Cryptid County, a tactical hidden-movement game. Cinematic wide 16:9 composition in the Pacific Northwest at night. Dense, tall, natural fir trunks frame a misty ravine; a massive, barely identifiable Sasquatch silhouette stands mid-distance on the right half, around 75 percent from the left edge, integrated into dark foreground trees, with faint pale haze behind its shoulders. Layers of dark conifer silhouettes, deep forest greens, olive moss, a low muted amber light like a far-off search lantern near the ground, subtle film grain, atmospheric and believable. Leftmost 40 percent is dark, quiet and low-detail for later cream title typography. Palette near-black pine green and muted ochre with no blue neon. Premium cinematic survival mystery game key art with a restrained realistic finish. No text, no graphics, no borders, no interface, no logos, no bright eyes, no gore. Make the forest and silhouette visible in a dark-themed menu.

[Search discovery artwork](./public/search-discoveries.png) was created with built-in ImageGen.

> Use case: illustration-story. Create one square 3-by-3 game-art atlas made of nine separate, perfectly square paintings in a precise edge-to-edge grid, each cell exactly one third of the whole width and height, no gutters, separators, frames, labels, letters, lettering, numbers or watermarks. Cryptid County is an atmospheric Pacific Northwest hidden-movement board game. Use realistic cinematic field photography and painterly natural textures, slightly luminous overcast light, dark fir woodland, forest moss green and earth brown, restrained amber, each subject readable in a small card thumbnail. Put the subject in each cell's center with breathing space. Strict top row left-to-right: a large mysterious barefoot footprint freshly impressed in dark wet mud; a few subtle red drops on ferns and leaves beside a trail (no gore); small scattered weathered bones and feathers on forest soil (no corpse). Strict middle row left-to-right: a cracked trail camera on the forest floor; an indistinct non-species-specific dark cryptid silhouette disappearing in fog between trees; a live wild rabbit among fern leaves. Strict bottom row left-to-right: a live wild turkey in a clearing; a live white-tailed deer watching from the treeline; a small broken wildlife tracking tag on the soil beside dark animal droppings. Keep all nine subjects and backgrounds isolated inside their corresponding squares with clean cell alignment. No characters handling the evidence. Square output.
