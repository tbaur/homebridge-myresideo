"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Hold a detector's last trusted state while Resideo reports it
 * unreachable, until the report has lasted long enough to believe.
 *
 * During a Resideo cloud incident the API answers 200 with a placeholder
 * record: every reachability flag says unreachable, the battery reads 0, and
 * the readings and alarms are gone. The detector is fine and the next poll or
 * two returns the real record. Without a hold each blip flips HomeKit and
 * pages offline and low battery, then resolves both minutes later.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceHold = void 0;
exports.withoutPlaceholderBattery = withoutPlaceholderBattery;
const mappers_1 = require("./utils/mappers");
/**
 * Drop the battery from an unreachable record. Resideo sends 0 there, and an
 * unreachable detector has no battery reading worth reporting.
 */
function withoutPlaceholderBattery(device) {
    if ((0, mappers_1.isDeviceActive)(device) || device.batteryRemaining === undefined) {
        return device;
    }
    const { batteryRemaining: _omitted, ...rest } = device;
    return rest;
}
/** Per-detector offline hold. One instance serves every detector. */
class DeviceHold {
    #holdMs;
    #now;
    #entries = new Map();
    constructor(holdMs, now = Date.now) {
        this.#holdMs = holdMs;
        this.#now = now;
    }
    /**
     * Remember a reachable record from before this process started, such as the
     * one on a cached accessory, so a placeholder at boot can be held. Ignored
     * once a live record exists or when the record is not reachable.
     */
    seed(device) {
        if (!device || !(0, mappers_1.isDeviceActive)(device) || this.#entries.has(device.deviceID)) {
            return;
        }
        this.#entries.set(device.deviceID, { trusted: device });
    }
    /** Filter one fresh body. Call for every body, from polls and from discovery. */
    apply(raw) {
        const entry = this.#entries.get(raw.deviceID) ?? {};
        this.#entries.set(raw.deviceID, entry);
        if ((0, mappers_1.isDeviceActive)(raw)) {
            entry.trusted = raw;
            entry.unreachableSince = undefined;
            return { device: raw, isOfflineHeld: false };
        }
        const now = this.#now();
        entry.unreachableSince ??= now;
        const reported = withoutPlaceholderBattery(raw);
        if (now - entry.unreachableSince >= this.#holdMs) {
            return { device: reported, isOfflineHeld: false };
        }
        if (!entry.trusted) {
            return { device: reported, isOfflineHeld: true };
        }
        // A placeholder says dry whether or not the detector is wet, so it can
        // raise a leak but must not clear one.
        return {
            device: { ...entry.trusted, waterPresent: entry.trusted.waterPresent || raw.waterPresent },
            isOfflineHeld: true,
        };
    }
    /** Forget a detector that left HomeKit. */
    release(deviceId) {
        this.#entries.delete(deviceId);
    }
}
exports.DeviceHold = DeviceHold;
//# sourceMappingURL=device-hold.js.map