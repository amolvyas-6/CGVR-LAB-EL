/**
 * Pure WebXR gamepad helpers. Trigger selection deliberately stays on the
 * WebXR `selectstart` event; these helpers only read optional stick/buttons.
 */

export const STICK_DEADZONE = 0.18;
export const STICK_SCRUB_PERCENT_PER_SECOND = 25;
export const MAX_STICK_DELTA_SECONDS = 0.1;

const TOUCH_PROFILE_IDS = new Set([
  'oculus-touch-v2',
  'oculus-touch-v3',
  'meta-quest-touch-plus',
]);

function safeLength(value) {
  try {
    return Number.isSafeInteger(value?.length) && value.length >= 0 ? value.length : 0;
  } catch {
    return 0;
  }
}

function profileNames(source) {
  try {
    if (!Array.isArray(source?.profiles)) return [];
    return source.profiles.filter((profile) => typeof profile === 'string');
  } catch {
    return [];
  }
}

function handednessOf(source) {
  try {
    return source?.handedness === 'left' || source?.handedness === 'right'
      ? source.handedness
      : 'none';
  } catch {
    return 'none';
  }
}

/**
 * Resolve only layouts backed by the WebXR `xr-standard` mapping or one of
 * the bundled/verified Touch profiles. An unknown profile can still aim and
 * trigger through WebXR events, but is not assigned guessed gamepad controls.
 */
export function detectInputMapping(source) {
  const profiles = profileNames(source);
  const profileId = profiles.find((profile) => TOUCH_PROFILE_IDS.has(profile)) ?? null;
  const handedness = handednessOf(source);
  let gamepad = null;
  let gamepadMapping = 'unavailable';
  let axesLength = 0;
  let buttonsLength = 0;

  try {
    gamepad = source?.gamepad ?? null;
    if (typeof gamepad?.mapping === 'string') gamepadMapping = gamepad.mapping || 'unmapped';
    axesLength = safeLength(gamepad?.axes);
    buttonsLength = safeLength(gamepad?.buttons);
  } catch {
    gamepad = null;
  }

  let horizontalAxisIndex = null;
  let axisMapping = null;
  if (handedness !== 'none' && axesLength >= 4) {
    if (gamepadMapping === 'xr-standard') {
      horizontalAxisIndex = 2;
      axisMapping = 'xr-standard-thumbstick';
    } else if (profileId) {
      // These Touch profile component layouts place the thumbstick at axes 2/3.
      horizontalAxisIndex = 2;
      axisMapping = `${profileId}-thumbstick`;
    }
  }

  let shortcut = null;
  let shortcutButtonIndex = null;
  let shortcutButtonName = null;
  if (handedness !== 'none' && profileId) {
    // Oculus/Meta Touch component layouts use A (right) and X (left) at 4.
    shortcutButtonIndex = 4;
    if (handedness === 'right') {
      shortcut = 'snap';
      shortcutButtonName = 'A';
    } else {
      shortcut = 'nextTarget';
      shortcutButtonName = 'X';
    }
  }

  return {
    handedness,
    profiles,
    profileId,
    profileKnown: Boolean(profileId),
    gamepadMapping,
    axesLength,
    buttonsLength,
    horizontalAxisIndex,
    axisMapping,
    shortcut,
    shortcutButtonIndex,
    shortcutButtonName,
    shortcutAvailable: shortcutButtonIndex !== null && buttonsLength > shortcutButtonIndex,
  };
}

/** Read a finite, clamped horizontal stick value; malformed axes are neutral. */
export function readHorizontalAxis(source, mapping = detectInputMapping(source)) {
  const axisIndex = mapping?.horizontalAxisIndex;
  if (!Number.isSafeInteger(axisIndex) || axisIndex < 0) return 0;
  try {
    const axis = source?.gamepad?.axes?.[axisIndex];
    return Number.isFinite(axis) ? Math.min(1, Math.max(-1, axis)) : 0;
  } catch {
    return 0;
  }
}

/**
 * Read a button in WebXR Gamepad shape without trusting sparse or malformed
 * polling data. Numeric value is used only when `pressed` is not true.
 */
export function readShortcutPressed(source, mapping = detectInputMapping(source)) {
  const buttonIndex = mapping?.shortcutButtonIndex;
  if (
    !mapping?.profileKnown
    || !Number.isSafeInteger(buttonIndex)
    || buttonIndex < 0
  ) return false;

  try {
    const button = source?.gamepad?.buttons?.[buttonIndex];
    if (typeof button?.pressed === 'boolean') return button.pressed;
    if (button && Number.isFinite(button.value)) return button.value > 0.5;
    return Number.isFinite(button) && button > 0.5;
  } catch {
    return false;
  }
}

/** Rescale stick travel outside the deadzone to the full [0, 1] range. */
export function applyStickDeadzone(value, deadzone = STICK_DEADZONE) {
  if (!Number.isFinite(value) || !Number.isFinite(deadzone)) return 0;
  const bounded = Math.min(1, Math.max(-1, value));
  const threshold = Math.min(0.99, Math.max(0, deadzone));
  const magnitude = Math.abs(bounded);
  if (magnitude <= threshold) return 0;
  return Math.sign(bounded) * ((magnitude - threshold) / (1 - threshold));
}

/** Convert one horizontal stick sample and XR frame delta to progress percent. */
export function stickScrubDelta(
  horizontalAxis,
  deltaSeconds,
  ratePercentPerSecond = STICK_SCRUB_PERCENT_PER_SECOND,
) {
  if (!Number.isFinite(ratePercentPerSecond) || ratePercentPerSecond <= 0) return 0;
  const dt = Number.isFinite(deltaSeconds)
    ? Math.min(MAX_STICK_DELTA_SECONDS, Math.max(0, deltaSeconds))
    : 0;
  return applyStickDeadzone(horizontalAxis) * ratePercentPerSecond * dt;
}

/** Return true for the one frame on which a sampled button becomes pressed. */
export function isRisingEdge(wasPressed, isPressed) {
  return isPressed === true && wasPressed !== true;
}
