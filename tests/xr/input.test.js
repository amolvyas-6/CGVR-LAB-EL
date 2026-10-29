import { describe, expect, it } from 'vitest';
import {
  applyStickDeadzone,
  detectInputMapping,
  isRisingEdge,
  readHorizontalAxis,
  readShortcutPressed,
  stickScrubDelta,
} from '../../src/xr/input.js';

function touchSource({ handedness = 'right', profile = 'oculus-touch-v3', gamepad } = {}) {
  return {
    handedness,
    profiles: ['generic-trigger', profile],
    gamepad,
  };
}

describe('detectInputMapping', () => {
  it('resolves the standard thumbstick and only profile-confirmed Touch shortcuts', () => {
    const source = touchSource({
      gamepad: {
        mapping: 'xr-standard',
        axes: [0, 0, 0.4, -0.2],
        buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })),
      },
    });

    expect(detectInputMapping(source)).toMatchObject({
      profileId: 'oculus-touch-v3',
      profileKnown: true,
      horizontalAxisIndex: 2,
      axisMapping: 'xr-standard-thumbstick',
      shortcut: 'snap',
      shortcutButtonIndex: 4,
      shortcutButtonName: 'A',
      shortcutAvailable: true,
    });
  });

  it('uses Touch profile component axes when mapping metadata is absent', () => {
    const source = touchSource({
      handedness: 'left',
      profile: 'meta-quest-touch-plus',
      gamepad: { mapping: '', axes: [0, 0, -0.7, 0], buttons: Array(5).fill(0) },
    });

    expect(detectInputMapping(source)).toMatchObject({
      profileId: 'meta-quest-touch-plus',
      horizontalAxisIndex: 2,
      axisMapping: 'meta-quest-touch-plus-thumbstick',
      shortcut: 'nextTarget',
      shortcutButtonIndex: 4,
      shortcutButtonName: 'X',
      shortcutAvailable: true,
    });
  });

  it('does not guess optional controls for unknown or unhanded sources', () => {
    const unknown = {
      handedness: 'right',
      profiles: ['generic-trigger'],
      gamepad: {
        mapping: 'xr-standard',
        axes: [0, 0, 0.5, 0],
        buttons: Array(6).fill({ pressed: true, value: 1 }),
      },
    };
    expect(detectInputMapping(unknown)).toMatchObject({
      horizontalAxisIndex: 2,
      profileKnown: false,
      shortcut: null,
      shortcutButtonIndex: null,
    });
    expect(readShortcutPressed(unknown)).toBe(false);

    const unhanded = {
      ...unknown,
      handedness: 'none',
      profiles: ['oculus-touch-v3'],
    };
    expect(detectInputMapping(unhanded)).toMatchObject({
      horizontalAxisIndex: null,
      shortcut: null,
    });
  });

  it('does not treat a two-axis or malformed gamepad as a thumbstick mapping', () => {
    expect(detectInputMapping({
      handedness: 'left',
      profiles: ['unknown'],
      gamepad: { mapping: 'xr-standard', axes: [0.8, 0], buttons: [] },
    }).horizontalAxisIndex).toBeNull();

    expect(detectInputMapping({
      handedness: 'left',
      profiles: ['oculus-touch-v2'],
      gamepad: { mapping: 'other', axes: [0, 0, Number.NaN, 0], buttons: [] },
    }).horizontalAxisIndex).toBe(2);
    expect(readHorizontalAxis({
      gamepad: { axes: [0, 0, Number.NaN, 0] },
    }, { horizontalAxisIndex: 2 })).toBe(0);
  });
});

describe('optional controller input', () => {
  it('reads only finite/clamped axes and valid pressed/value button states', () => {
    const source = touchSource({
      gamepad: {
        mapping: 'xr-standard',
        axes: [0, 0, 4, Number.NaN],
        buttons: [null, , , , { pressed: false, value: 0.8 }],
      },
    });
    const mapping = detectInputMapping(source);
    expect(readHorizontalAxis(source, mapping)).toBe(1);
    expect(readShortcutPressed(source, mapping)).toBe(false);

    source.gamepad.buttons[4] = { pressed: true, value: 0 };
    expect(readShortcutPressed(source, mapping)).toBe(true);
    source.gamepad.buttons[4] = { value: 0.7 };
    expect(readShortcutPressed(source, mapping)).toBe(true);
    source.gamepad.buttons[4] = { value: Number.NaN };
    expect(readShortcutPressed(source, mapping)).toBe(false);
  });

  it('rescales the deadzone and computes bounded dt-based progress deltas', () => {
    expect(applyStickDeadzone(0.18)).toBe(0);
    expect(applyStickDeadzone(-0.18)).toBe(0);
    expect(applyStickDeadzone(1)).toBe(1);
    expect(applyStickDeadzone(-0.5)).toBeCloseTo(-0.32 / 0.82);
    expect(applyStickDeadzone(Number.NaN)).toBe(0);

    expect(stickScrubDelta(0.18, 0.1)).toBe(0);
    expect(stickScrubDelta(1, 0.1)).toBe(2.5);
    expect(stickScrubDelta(-1, 1)).toBe(-2.5);
    expect(stickScrubDelta(1, -1)).toBe(0);
    expect(stickScrubDelta(1, Number.NaN)).toBe(0);
  });

  it('reports a single rising edge while a face button remains held', () => {
    expect(isRisingEdge(false, true)).toBe(true);
    expect(isRisingEdge(true, true)).toBe(false);
    expect(isRisingEdge(true, false)).toBe(false);
    expect(isRisingEdge(false, false)).toBe(false);
  });
});
