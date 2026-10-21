# @tasermonkey/ic10-bench-ds8 reference

How the rack behaves comes from the mod's own code (ServerRack.dll 5.12.2, decompiled) and its
Stationpedia page. Numbers are as the game shows them: processors 1-12, I/O ports 1-32, bays 1-8,
banks 0-7.

## `serverRack` options

The third argument to `sim().add(key, serverRack, options)`.

| Option | Default | What it does |
|---|---|---|
| `chips` | none | The chips, by processor: index = processor − 1, holes for empty sockets. Each is `{ key, file }` or `{ key, code }`; `world.chip(key)` finds it. |
| `pins` | none | Which device key is on each pin, as `.housing()` takes them. The device goes on the I/O port the pin's patch cable reaches. |
| `patch` | d0 → port 1 … d5 → port 6 | Patch cables moved: a pin to a port 1-8, or `null` for unplugged. |
| `ports` | none | Devices on ports with no pin, by port 1-32. Ports 9-32 exist only in software; a script reads their IDs from memory and uses `ld`/`sd`. |
| `drives` | all 8 bays | Bays (1-8) with a drive in them. |
| `banks` | bay n → bank n − 1 | Drive patch cables moved: a bay to a bank 0-7, or `null`. |
| `memory` | none | Starting cells, by address. |
| `driveCapacity` | 512 | Cells per drive: the mod's DriveCapacity setting (64-4096). The status registers start at 8 × this. |
| `switches` | see below | The rack's switches. |
| `cpuMultiplier` | 1 | The BIOS's CPU multiplier: 0.5, 1 or 2. |
| `scratchReadOnly` | `false` | The BIOS's "Scratch cells: read only". |
| `motherboard` | `true` | Whether a system board is fitted. Without one the rack doesn't start. |
| `autostart` | `true` | Chips run as soon as the rack starts (DIP 4), and the world starts with it running, as a save loads. With `false` they're held, at the start and after every power-up, until the handle's `start()`. |
| `status` | a healthy rack on mains | Status registers a test sets: `upsRatio`, `onBattery`, `filter`, `fanMode`, `activity`, `uptime`, `timeOfDay`, `alarm`, `operatingHours`, `alarmTemperature`, `hatchOpen`, `batteryHealth`, `mainsPresent`. |

`add()`'s fourth argument places the rack (`network`, `id`, `name`) and sets its `props`: it starts
with `On` = 1 and `Temperature` = 318.15 K (45 °C, where it sits in base air).

### Switches

| Switch | Default | What it does |
|---|---|---|
| `io` | on | I/O: chips reach devices. Off, every pin is empty, `ld`/`sd` by ID find nothing, and a batch instruction stops the chip with DeviceListNull. The ports' IDs still read. |
| `memWrite` | on | MEM WR: the rack's own chips can write its drives. Off, their writes are dropped (a fault); a chip elsewhere still can. |
| `remote` | on | REM: chips elsewhere can write the rack's `Setting`, `Index`, `Mode`, `Lock`, `ClearMemory` and `LineNumber`. Off, those writes are dropped (a fault). |
| `maint` | off | MAINT: maintenance mode, which drops those writes too. |
| `turbo` | off | TURBO: twice the lines per tick. |
| `clock` | `"HI"` | CLOCK: lines per tick for each processor: `LO` 32, `MED` 64, `HI` 128, `MAX` 256. |
| `prog` | 1 | PROG: the processor whose line `LineNumber` reads and writes. |
| `run` | all on | RUN per processor (index = processor − 1). Off, it's halted where it is, and carries on from there when it's on again. |

## Chips in the rack

- **Running.** Processors run in order, 1 to 12, at the place in turn order where the rack is
  declared. Each runs `CLOCK × TURBO × cpuMultiplier` lines a tick, 128 by default.
- **`db`.** `db` is the rack, for its logic, slots and memory. A chip's own stack (`push`, `pop`,
  `peek`, `poke`, `sp`) is still its own.
- **Pins.** d0-d5 are shared by every chip. Each goes through its patch cable to a port, and the
  port holds a device ID. That device must be on the rack's data network; one that isn't leaves the
  port empty. An empty pin is DeviceNotFound, as in a housing.
- **By ID and batch.** `ld`/`sd` by ID and batch instructions see the rack's data network.
- **Power.** With the rack switched off (`On` = 0), without a system board, or overheated, its
  chips stop. When it's back, they carry on from the line they were on, with their registers.
  In game, only putting a chip back in its socket, or resetting its processor, starts it over.

## Memory

`get`, `put` and `clr` on the rack, from its own chips (`db`) or from a chip elsewhere:

| Address | What it is |
|---|---|
| 0 … 8 × capacity − 1 | Drive cells. Bank n is n × capacity onward. A bank with no drive patched to it reads 0 and drops writes, each counting a fault. Writes are also dropped (a fault) while locked (`Lock` = 1) and, from the rack's own chips, with MEM WR off. |
| 8 × capacity + 0 … 87 | Status registers (below). Writes are dropped (a fault), except to the scratch cells. They read 0 while the rack is off. |
| below 0 | StackUnderFlow: the chip halts. |
| past the status registers | StackOverFlow: the chip halts. |

`clr` formats every drive. Status registers, at 4096 + offset with 512-cell drives:

| Address | Value |
|---|---|
| 4096 | Core temperature (°C): the rack's `Temperature` − 273.15. |
| 4097 | Power (W): its `PowerActual`. |
| 4098-4105 | UPS ratio, on battery, filter, fan mode, I/O load, up time (s), time of day (min), alarm: as set in `status`. |
| 4106 | Drives online (patched to a bank). |
| 4107 | Used cells (not 0). |
| 4108 | Capacity on line. |
| 4109-4111 | Reads, writes, faults. |
| 4112-4115 | Line of processors 1-4 (-1 with no chip). |
| 4116-4119 | State of processors 1-4. |
| 4120-4122 | Operating hours, alarm temperature, hatch open: as set in `status`. |
| 4123 | Write protection. |
| 4124-4125 | Battery health, mains present: as set in `status`. |
| 4126 | Maintenance mode. |
| 4127 | The asking processor: 1-12, or 0 for a chip elsewhere. |
| 4128-4135 | Device IDs on ports 1-8. |
| 4136-4143 | Eight shared scratch cells. |
| 4144-4151 | Line of processors 5-12. |
| 4152-4159 | State of processors 5-12. |
| 4160-4183 | Device IDs on ports 9-32. |

States: 0 empty, 1 halted (RUN off, held, or the rack off), 2 running, 3 error (the chip halted on
an error), 4 bad code, 5 step.

## Logic

| Logic type | Read | Write |
|---|---|---|
| `Setting` | The cell at `Index`. | Writes the cell at `Index`. |
| `Index` | The address pointer. | Sets it, wrapped into the drives. |
| `Mode` | The program on the screen, 0-12. | Sets it. |
| `Lock` | Write protection. | Sets it. |
| `Quantity`, `Maximum`, `Ratio` | Used cells, capacity on line, and their ratio. | |
| `LineNumber` | The PROG processor's line. | Moves that processor to the line. |
| `ClearMemory` | | 1 formats the drives. |
| `Temperature`, `Charge`, `PowerActual`, `RequiredPower`, `Idle`, `Error`, `On` | Plain properties a test sets. | |

Slots: 0-7 drive bays, 8-11 processors 1-4, 12 the system board, 13-20 processors 5-12, 21 a battery
cell. A fitted drive, chip or board shows in its slot (`ls db 0 Occupied`).

## Handle (`serverRack.handle(world, key)`)

| Member | What it does |
|---|---|
| `device` | The rack's IC10 Bench device handle. |
| `size` | Cells on the drives together; the status registers start here. |
| `memory(address)` / `setMemory(address, v)` | Reads a cell or status register as it is (no faults or counts) / sets a cell, whatever the switches say. |
| `drive(bay)` | A bay's drive's cells, or `undefined`. |
| `insertDrive(bay, cells?)` / `removeDrive(bay)` | Slides a drive in / pulls one out (its cells go with it, and are returned). |
| `bank(bay, bank \| null)` | Moves a bay's patch cable. |
| `patch(pin, port \| null)` / `patchOf(pin)` | Moves a pin's patch cable / the port it goes to. |
| `port(n, key \| null)` / `portDevice(n)` | Puts a device on a port, or empties it / the device on a port. |
| `assignPin(pin, key)` | As the Network program's "pins in one key": the device goes on the port the pin's cable reaches; a pin with no cable gets the first free port 1-8. |
| `setSwitch(name, value)` / `switches` | Sets a switch (not RUN) / every switch. |
| `run(processor, on)` | Flips a processor's RUN switch. |
| `start()` | Starts processors held since power-up (`autostart: false`). |
| `processor(n)` | A processor's `state` (`"running"`, `"halted"`, `"error"`, …) and `line`. |
| `setStatus(name, v)` | Sets a status register the rack doesn't work out. |
| `overheat(on?)` | Overheats the rack (`Error` = 1): its drives go off line. |
| `motherboard(fitted)` | Fits or pulls the system board. |
| `reads`, `writes`, `faults` | The rack's counters, as status registers 4109-4111. |

## Not simulated

- The rack's rules, scenes, its ready-made programs and print jobs.
- Its screens and keys, the debugger, and the code check.
- Heat, the air filter and the UPS: they're properties and status registers a test sets.
- A processor's stepping, breakpoints and the DEBUG switch.
- Bank write-protect switches.
