import type { Item } from "../types";
import ItemCard from "./ItemCard";

const UNASSIGNED = "Unassigned";
const NEW_ROOM = "__new__";

interface Props {
  items: Item[];
  /** Existing room names in the project, offered in the quick room selector. */
  rooms: string[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (item: Item) => void;
  onPresent: (item: Item) => void;
  /** Assign an item to a room (""/Unassigned clears it). */
  onSetRoom: (item: Item, room: string) => void;
}

/**
 * The client project view: items grouped under room headings, with a quick
 * room selector on each card so a freshly-added "Unassigned" pile can be sorted
 * without opening the editor. Room order is first-seen, with Unassigned last —
 * matching how TearSheetPrint groups rooms for printing.
 */
export default function RoomGroupedGallery({
  items,
  rooms,
  selected,
  onToggleSelect,
  onEdit,
  onPresent,
  onSetRoom,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <p>No items yet.</p>
        <p className="muted">
          Add an item, import a spreadsheet, or pull pieces in from your database.
        </p>
      </div>
    );
  }

  const groups = groupByRoom(items);

  return (
    <div className="room-groups">
      {groups.map(([room, roomItems]) => (
        <section className="room-group" key={room}>
          <h2 className="room-group-title">
            {room}
            <span className="room-group-count">{roomItems.length}</span>
          </h2>
          <div className="gallery">
            {roomItems.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                selected={selected.has(it.id)}
                onToggleSelect={onToggleSelect}
                onEdit={(item) => onEdit(item as Item)}
                onPresent={() => onPresent(it)}
                extraControl={
                  <RoomSelect item={it} rooms={rooms} onSetRoom={onSetRoom} />
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A compact room picker shown on each card in the grouped view. */
function RoomSelect({
  item,
  rooms,
  onSetRoom,
}: {
  item: Item;
  rooms: string[];
  onSetRoom: (item: Item, room: string) => void;
}) {
  const current = item.room.trim();
  // Include the item's own room even if it's the only one with that name.
  const options = [...new Set([...rooms, current].filter(Boolean))];

  function onChange(value: string) {
    if (value === NEW_ROOM) {
      const name = window.prompt("New room name:", "")?.trim();
      if (name) onSetRoom(item, name);
      return;
    }
    onSetRoom(item, value);
  }

  return (
    <label className="room-select" onClick={(e) => e.stopPropagation()}>
      <span className="room-select-label">Room</span>
      <select value={current} onChange={(e) => onChange(e.target.value)}>
        <option value="">{UNASSIGNED}</option>
        {options.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value={NEW_ROOM}>＋ New room…</option>
      </select>
    </label>
  );
}

/** Group items by room, first-seen order, with Unassigned (no room) last. */
function groupByRoom(items: Item[]): [string, Item[]][] {
  const map = new Map<string, Item[]>();
  let unassigned: Item[] | null = null;
  for (const it of items) {
    const room = it.room?.trim();
    if (!room) {
      if (!unassigned) unassigned = [];
      unassigned.push(it);
      continue;
    }
    if (!map.has(room)) map.set(room, []);
    map.get(room)!.push(it);
  }
  const groups: [string, Item[]][] = [...map.entries()];
  if (unassigned) groups.push([UNASSIGNED, unassigned]);
  return groups;
}
