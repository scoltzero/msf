// Adapted from Zephyruso/zashboard v3.18.0 under the MIT License.
// Copyright 2024 Zephyruso. See /THIRD_PARTY_NOTICES.md.
export const DBIP_CITY_VERSION = '1.0.16'
export const DBIP_CITY_URL = `https://cdn.jsdelivr.net/npm/dbip-city-lite@${DBIP_CITY_VERSION}/dbip-city-lite.mmdb.gz`
export const DBIP_COMPRESSED_BYTES = 61_700_000
export const DBIP_STORED_BYTES = 130_200_000

export type EarthOriginSource = 'global' | 'china'

export type EarthEndpointRole = 'origin' | 'destination'

export interface EarthLocation {
  ip: string
  latitude: number
  longitude: number
  city: string
  country: string
}

export interface EarthHostTraffic {
  host: string
  downloaded: number
}

export interface EarthRoute {
  key: string
  path: Array<EarthLocation & { role: EarthEndpointRole }>
  connections: number
  upload: number
  download: number
  topHosts: EarthHostTraffic[]
}

export interface EarthEndpointInfo {
  city: string
  country: string
  role: EarthEndpointRole
  connections: number
  topHosts: EarthHostTraffic[]
}

export type GeoDatabaseStatus =
  'checking' | 'idle' | 'loading-cache' | 'downloading' | 'ready' | 'error'

export type GeoDatabaseError =
  'space' | 'network' | 'decompress' | 'invalid' | 'storage' | 'unsupported' | 'unknown'

export type GeoWorkerRequest =
  | { type: 'init' }
  | { type: 'download' }
  | { type: 'cancel' }
  | { type: 'lookup'; id: number; ips: string[]; locale: string }

export type GeoWorkerResponse =
  | {
      type: 'status'
      status: GeoDatabaseStatus
      received?: number
      total?: number
      error?: GeoDatabaseError
      recoveredCorruptCache?: boolean
    }
  | { type: 'lookup'; id: number; locations: Record<string, EarthLocation | null> }
