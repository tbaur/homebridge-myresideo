# Resideo / Honeywell Home API Reference

Evaluation of the API as published at <https://developer.honeywellhome.com>,
scoped to what this plugin needs (OAuth2 + Water Leak Detector).

> **Critical:** The base host is **`https://api.honeywellhome.com`**. The legacy
> `api.honeywell.com` host is deprecated and its certificate retired — using it
> is what broke older integrations.

## Authentication — OAuth2 Authorization Code flow

Every API request requires **both**:

1. An OAuth2 **bearer access token** in the `Authorization` header.
2. The developer **`apikey`** (your Consumer/API Key) as a **query parameter**.

### 1. Authorize (browser redirect)

```
GET https://api.honeywellhome.com/oauth2/authorize
      ?response_type=code
      &client_id={apikey}
      &redirect_uri={redirectUri}
```

Resideo redirects back to `{redirectUri}?code={authorizationCode}`.

### 2. Exchange the code for tokens

```
POST https://api.honeywellhome.com/oauth2/token
Authorization: Basic base64("{apikey}:{apiSecret}")
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={code}&redirect_uri={redirectUri}
```

Response:

```json
{
  "access_token": "k8sbPR4is2C7ipTYgEbi8fe470mp",
  "refresh_token": "dQJiREMfaHhDBoGohIj7JEpIOYYk9Jif",
  "expires_in": "1799"
}
```

### 3. Refresh the access token

```
POST https://api.honeywellhome.com/oauth2/token
Authorization: Basic base64("{apikey}:{apiSecret}")
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={refreshToken}
```

Notes:

- `expires_in` is returned **as a string** (~`1799` seconds / ~30 min).
- The refresh token **rotates** — a new `refresh_token` may be returned and must
  be persisted, or the next refresh fails.
- An expired/invalid refresh token returns **`400 invalid_grant`** → the user
  must re-link their account.

## Locations

```
GET https://api.honeywellhome.com/v2/locations?apikey={apikey}
Authorization: Bearer {accessToken}
```

Returns an array of locations; each has a numeric `locationID` and a `devices`
array (devices are embedded, so discovery needs only this one call).

## Water Leak Detector

### Get a specific detector

```
GET https://api.honeywellhome.com/v2/devices/waterLeakDetectors/{deviceId}
      ?apikey={apikey}&locationId={locationId}
Authorization: Bearer {accessToken}
```

### Relevant response fields

| Field | Type | Meaning |
|---|---|---|
| `deviceID` | string | Unique device ID (UUID). |
| `deviceClass` | string | `"LeakDetector"` for water leak detectors. |
| `deviceType` | string | `"Water Leak Detector"`. |
| `userDefinedDeviceName` | string | Name shown in the Honeywell Home app. |
| `waterPresent` | boolean | **True when water is detected** (drives Leak Sensor). |
| `currentSensorReadings.temperature` | number | Celsius. |
| `currentSensorReadings.humidity` | number | Percentage. |
| `batteryRemaining` | integer | Battery percent. |
| `hasDeviceCheckedIn` | boolean | Recently checked in (drives StatusActive). |
| `isDeviceOffline` / `isAlive` | boolean | Connectivity. |
| `currentAlarms[]` | array | e.g. `HighTemperature`, `HighHumidity`, `DeviceOffline`. |
| `deviceSettings.temp.low.limit` | number | Configured low-temp alert limit (Celsius) — used as the default freeze threshold. |

### Freeze detection

The API exposes no dedicated "freeze" boolean. This plugin derives a freeze
condition by comparing `currentSensorReadings.temperature` against a threshold
(per-device override → device's `deviceSettings.temp.low.limit` → plugin
default of 4°C) and exposes it as an optional HomeKit Contact Sensor.

## Endpoints not used by this plugin

`thermostats` and `cameras` device types, and the
`/devices/waterLeakDetectors/{deviceId}/history` (temperature/humidity history)
endpoint, are out of scope.
