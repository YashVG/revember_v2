# Bluetooth Low Energy

## Purpose

This note is the LLM-friendly source for the BLE topic. It should preserve the natural-language explanation, concept boundaries, likely confusions, and learning-session context that would be awkward to maintain directly inside JSON.

The app-ready version is compiled into:

```text
../topics/ble.json
```

## Learning Goal

Understand BLE from physical bits up through Link Layer, GAP, GATT, characteristics, and notifications.

The core ladder is:

```text
physical state -> bit -> byte -> protocol -> BLE PHY -> Link Layer -> GAP -> GATT -> characteristic -> notification -> app parser
```

This line is a teaching overview, not the graph schema. The app graph uses the explicitly authored relationships in `topics/ble.json`, including prerequisites, part-of links, contrasts, and enabling links. Reordering concepts must not change those semantics.

The main goal is not memorizing names. The goal is knowing which layer answers which question:

- Can a physical radio signal become bits?
- Can two devices exchange timed packets?
- How do devices discover and connect?
- Where does a connected app-level value live?
- What still has to be parsed by the iPhone app?

## First-Principles Map

### Bits

A bit is information represented by a distinguishable physical state.

Software calls the state `0` or `1`, but the machine still needs a physical difference it can measure. In electronics that difference is usually voltage, current, charge, or a radio signal state.

Important boundary:

- A bit is not a packet.
- A bit is not a protocol.
- A bit is not automatically meaningful data.

Likely confusions:

- protocol
- packet
- byte

Gap tag:

- physical substrate

### Bytes

A byte is eight bits, which gives 256 possible patterns.

A byte is not automatically meaningful. It becomes meaningful only when a protocol or schema says how to interpret the bit pattern.

Important boundary:

- `0x01` is just a pattern until something says what it means.
- Eight bits can represent 256 patterns, but the semantic meaning depends on the schema.

Likely confusions:

- field
- packet

Gap tag:

- representation

### Protocol

A protocol is a rulebook for interpreting and exchanging bit patterns.

Two devices can receive the same bit pattern and still disagree unless they share rules for packet shape, timing, roles, fields, and meaning.

Important boundary:

- Electricity or radio can carry bits.
- A protocol explains how to interpret and coordinate those bits.
- A custom payload schema is also a protocol-like agreement at the application level.

Likely confusions:

- radio
- electricity
- data

Gap tag:

- protocol/schema

### PHY Layer

The PHY layer handles the physical radio path between signal and bits.

The PHY layer does not know what a sensor value means. It makes the radio transmission possible and turns radio energy into bits that higher layers can use.

Important boundary:

- PHY is closest to radio energy.
- PHY is below packet-exchange mechanics and below app-level meaning.

Likely confusions:

- Link Layer
- GAP
- GATT

Gap tag:

- layer mapping

### Link Layer

The Link Layer controls radio packet exchange and connection mechanics.

It decides when packets are exchanged, whether a device is advertising or connected, and how connection events are maintained. It is below the app-level meaning of the data.

Important boundary:

- Link Layer is about transport mechanics.
- Link Layer is not where sensor fields are defined.
- Link Layer is not the same as GATT.

Likely confusions:

- PHY
- GATT
- application

Gap tags:

- layer mapping
- transport mechanics

### GAP

GAP defines device discovery, roles, advertising, and connection setup.

GAP is how BLE devices become discoverable and decide who connects to whom. It is not the place where the sensor payload's fields are defined.

Important boundary:

- GAP owns advertising and central/peripheral roles.
- GAP is not GATT.
- GAP does not define the custom meaning of bytes inside a sensor payload.

Likely confusions:

- GATT
- service
- characteristic

Gap tag:

- role mapping

### GATT

GATT is the connected-data model for services and characteristics.

GATT gives connected devices an application-level structure: services contain characteristics, and characteristics expose values that can be read, written, or notified.

Important boundary:

- GATT exists after a connection.
- GATT structures values but does not automatically parse custom payload fields.
- GATT is app-visible, unlike lower radio mechanics.

Likely confusions:

- GAP
- raw packet
- PHY

Gap tag:

- application mapping

### Characteristic

A characteristic is a named GATT value with allowed operations.

A characteristic is where a value lives in GATT. An iPhone can receive a notification from a characteristic, but it still needs app logic to parse the bytes.

Important boundary:

- A characteristic is not a packet.
- A characteristic is not the connection itself.
- A characteristic exposes a value and operations such as read, write, and notify.

Likely confusions:

- service
- packet
- connection

Gap tag:

- implementation mapping

### Notifications

A notification sends a characteristic value update to a connected subscriber.

Calling `bt_gatt_notify()` does not create the sample. It asks the BLE stack to send an already-prepared value through the characteristic to the subscribed central.

Important boundary:

- Sample creation comes before notification.
- Notification transports an existing characteristic value update.
- The iPhone app still parses the bytes according to the custom payload schema.

Likely confusions:

- creating a sample
- parsing
- connection

Gap tags:

- direction-of-causality
- implementation mapping

## Known Gaps

### Physical Signal vs Meaning

Tag: concept conflation

Knowing that data is electrical is not enough. A receiver also needs an agreed rulebook for what each bit pattern means.

Related concepts:

- bits
- protocol

### BLE Layer Boundaries

Tag: abstraction-level jump

Different BLE layers answer different questions: can radio become bits, can packets be exchanged, and what app-level value changed.

Related concepts:

- PHY
- Link Layer
- GATT

### Sample Creation vs Transport

Tag: implementation mapping gap

Creating data, storing it in a packet, sending a notification, and parsing it on the iPhone are separate steps.

Related concepts:

- notifications
- characteristic

## Retrieval Checks To Preserve

These checks currently exist in `topics/ble.json`. Keep them diagnostic: each wrong option should represent a plausible misconception, not a random distractor.

Each choice now carries a rationale; every wrong choice also carries a stable misconception ID. Question revisions and source references make future learning evidence attributable to the exact check that produced it.

1. At the lowest useful level, what is a bit?
2. How many possible bit patterns can one byte represent?
3. Why do two devices need a protocol?
4. Which BLE layer is closest to radio energy becoming bits?
5. What does the BLE Link Layer mainly do?
6. Which BLE layer describes advertising and central/peripheral roles?
7. What is GATT in BLE?
8. In GATT, what is a characteristic?
9. What does `bt_gatt_notify()` conceptually do?
10. If an iPhone gets a custom BLE notification, what does it know by default?

## Compilation Notes For JSON

When compiling this Markdown into `topics/ble.json`, preserve stable IDs:

- topic ID: `ble`
- concept IDs: `bits`, `bytes`, `protocol`, `phy`, `link-layer`, `gap`, `gatt`, `characteristic`, `notify`
- question IDs: `ble-q001` through `ble-q010`

Use JSON for:

- stable concept fields
- gap tags
- multiple-choice questions
- correct answer flags
- authored review metadata, including diagnostic IDs, revisions, relationships, and source references

Keep learner-specific scheduling, due dates, and answer evidence in local progress rather than authored topic JSON.

Use this Markdown file for:

- richer explanation
- messy session notes
- examples
- open questions
- future concept expansion

## Open Expansion Areas

Potential next BLE concepts:

- ATT vs GATT
- services vs characteristics
- MTU
- connection interval
- notification vs indication
- custom payload schema
- Zephyr `bt_gatt_notify()` call path
- iOS CoreBluetooth central/peripheral mapping
