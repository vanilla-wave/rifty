Build a room reservation application on this installed minimal Vue starter.

Create/edit/delete named rooms with positive integer capacity. Room names are
trimmed and unique case-insensitively. Empty rooms can be deleted; a room with
reservations cannot be deleted. Invalid room edits and capacity reductions that
would invalidate existing reservations preserve all prior rooms/reservations.

Create/edit/delete reservations: room, calendar date YYYY-MM-DD, start/end HH:MM,
positive integer seats. Start must precede end; seats cannot exceed room capacity.
A room is exclusive: same-room/same-date half-open intervals [start,end) cannot
overlap; adjacent intervals are valid. Different rooms/dates are independent.
Invalid creation/edit preserves prior reservations, including an edited record.
Dates/times are calendar fields, no timezone conversion or current-date restriction.

Show reservation room/date/start/end/seats, sorted by date then start; equal
start/date order is open. Case-insensitive room-name and date filters combine;
clearing them restores all records. Rooms and reservations persist across reload;
invalid operations never persist or silently discard records.

Provide accessible editable Room name/Capacity and Reservation room/Date/Start/
End/Seats controls, named room/reservation add/save/edit/delete actions, and
Room filter/Date filter controls. Identify row actions with their room and start
(or another visible stable record identity). Validation is visible. Layout/DOM,
component structure and styling are open. No sample-data hardcoding.
