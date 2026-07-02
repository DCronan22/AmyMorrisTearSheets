import { memo } from "react";
import type { Item } from "../types";
import { formatPrice, projectTotal } from "../util";
import ItemCard from "./ItemCard";
import type { CardItem } from "./ItemCard";

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
  /** Show the vendor on each card (visual only). */
  showVendor?: boolean;
}

/**
 * The client project view: items grouped under room headings, with a quick
 * room selector on each card so a freshly-added "Unassigned" pile can be sorted
 * without opening the editor. Room order is first-seen, with Unassigned last.
 */
export default function RoomGroupedGallery({
  items,
  rooms,
  selected,
  onToggleSelect,
  onEdit,
  onPresent,
  onSetRoom,
  showVendor = true,
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
      {groups.map(([room, roomItems]) => {
        const roomTotal = projectTotal(roomItems);
        return (
        <section className="room-group" key={room}>
          <h2 className="room-group-title">
            {room}
            <span className="room-group-count">{roomItems.length}</span>
            {roomTotal > 0 && (
              <span className="room-group-total" title={`Total price for ${room}`}>
                {formatPrice(roomTotal)}
              </span>
            )}
          </h2>
          <div className="gallery">
            {roomItems.map((it) => (
              <RoomGroupedCard
                key={it.id}
                item={it}
                rooms={rooms}
                selected={selected.has(it.id)}
                showVendor={showVendor}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onPresent={onPresent}
                onSetRoom={onSetRoom}
              />
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
}

/**
 * One card in the grouped view. Memoized so a search keystroke or a selection
 * toggle only re-renders the cards whose props actually changed — galleries can
 * hold hundreds of image-heavy cards. The per-card closures (present, room
 * select) are created in here, where memo already scopes them to this item.
 */
const RoomGroupedCard = memo(function RoomGroupedCard({
  item,
  rooms,
  selected,
  showVendor,
  onToggleSelect,
  onEdit,
  onPresent,
  onSetRoom,
}: {
  item: Item;
  rooms: string[];
  selected: boolean;
  showVendor: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (item: Item) => void;
  onPresent: (item: Item) => void;
  onSetRoom: (item: Item, room: string) => void;
}) {
  return (
    <ItemCard
      item={item}
      selected={selected}
      showVendor={showVendor}
      onToggleSelect={onToggleSelect}
      onEdit={(it: CardItem) => onEdit(it as Item)}
      onPresent={() => onPresent(item)}
      extraControl={<RoomSelect item={item} rooms={rooms} onSetRoom={onSetRoom} />}
    />
  );
});

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
