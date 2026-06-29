"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Utility barrel exports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeFreezeThreshold = exports.validateConfig = exports.maskToken = exports.sanitizeError = exports.sanitizeString = exports.delay = exports.backoffMs = exports.activeAlarmTypes = exports.hasActiveAlarms = exports.isDeviceActive = exports.isWaterLeakDetector = exports.clampBatteryLevel = exports.isFreezing = exports.resolveFreezeThreshold = exports.isLowBattery = exports.isLeakDetected = void 0;
var mappers_1 = require("./mappers");
Object.defineProperty(exports, "isLeakDetected", { enumerable: true, get: function () { return mappers_1.isLeakDetected; } });
Object.defineProperty(exports, "isLowBattery", { enumerable: true, get: function () { return mappers_1.isLowBattery; } });
Object.defineProperty(exports, "resolveFreezeThreshold", { enumerable: true, get: function () { return mappers_1.resolveFreezeThreshold; } });
Object.defineProperty(exports, "isFreezing", { enumerable: true, get: function () { return mappers_1.isFreezing; } });
Object.defineProperty(exports, "clampBatteryLevel", { enumerable: true, get: function () { return mappers_1.clampBatteryLevel; } });
Object.defineProperty(exports, "isWaterLeakDetector", { enumerable: true, get: function () { return mappers_1.isWaterLeakDetector; } });
Object.defineProperty(exports, "isDeviceActive", { enumerable: true, get: function () { return mappers_1.isDeviceActive; } });
Object.defineProperty(exports, "hasActiveAlarms", { enumerable: true, get: function () { return mappers_1.hasActiveAlarms; } });
Object.defineProperty(exports, "activeAlarmTypes", { enumerable: true, get: function () { return mappers_1.activeAlarmTypes; } });
var backoff_1 = require("./backoff");
Object.defineProperty(exports, "backoffMs", { enumerable: true, get: function () { return backoff_1.backoffMs; } });
Object.defineProperty(exports, "delay", { enumerable: true, get: function () { return backoff_1.delay; } });
var sanitizers_1 = require("./sanitizers");
Object.defineProperty(exports, "sanitizeString", { enumerable: true, get: function () { return sanitizers_1.sanitizeString; } });
Object.defineProperty(exports, "sanitizeError", { enumerable: true, get: function () { return sanitizers_1.sanitizeError; } });
Object.defineProperty(exports, "maskToken", { enumerable: true, get: function () { return sanitizers_1.maskToken; } });
var validators_1 = require("./validators");
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return validators_1.validateConfig; } });
Object.defineProperty(exports, "sanitizeFreezeThreshold", { enumerable: true, get: function () { return validators_1.sanitizeFreezeThreshold; } });
//# sourceMappingURL=index.js.map