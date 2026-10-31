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
import type { WaterLeakDetector } from './types';
/** What callers should apply for one detector body. */
export interface HeldDevice {
    /** The record to show. A fresh leak always shows; a held leak is never cleared by a placeholder. */
    device: WaterLeakDetector;
    /**
     * True while an unreachable report is inside the hold. Callers that page
     * must not treat this record as offline.
     */
    isOfflineHeld: boolean;
}
/**
 * Drop the battery from an unreachable record. Resideo sends 0 there, and an
 * unreachable detector has no battery reading worth reporting.
 */
export declare function withoutPlaceholderBattery(device: WaterLeakDetector): WaterLeakDetector;
/** Per-detector offline hold. One instance serves every detector. */
export declare class DeviceHold {
    #private;
    constructor(holdMs: number, now?: () => number);
    /**
     * Remember a reachable record from before this process started, such as the
     * one on a cached accessory, so a placeholder at boot can be held. Ignored
     * once a live record exists or when the record is not reachable.
     */
    seed(device: WaterLeakDetector | undefined): void;
    /** Filter one fresh body. Call for every body, from polls and from discovery. */
    apply(raw: WaterLeakDetector): HeldDevice;
    /** Forget a detector that left HomeKit. */
    release(deviceId: string): void;
}
//# sourceMappingURL=device-hold.d.ts.map