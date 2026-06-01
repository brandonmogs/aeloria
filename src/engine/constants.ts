/**
 * The heartbeat of the simulation. Every game action — movement, combat,
 * skilling, queued interactions — resolves on this 600ms cadence, exactly
 * like Old School RuneScape. The render loop runs far faster and simply
 * interpolates between the most recent two tick states.
 */
export const TICK_MS = 600;

export const TICKS_PER_SECOND = 1000 / TICK_MS;

/** World size of a single tile, in render units. */
export const TILE_SIZE = 1;

/** Movement distance covered per tick, in tiles. */
export const WALK_SPEED = 1;
export const RUN_SPEED = 2;
