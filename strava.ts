// Shared by the hosted relay and browser callback validation.
export const STRAVA_ISSUER = 'https://www.strava.com';
export const STRAVA_RESOURCE = 'https://mcp.strava.com/mcp';
export const STRAVA_CLIENT_ID = '248572';
export const STRAVA_REDIRECT = 'http://localhost:61847/callback';
export const STRAVA_SCOPES = 'read read_all activity:read activity:read_all profile:read_all';

export interface LoginContext {
  readonly authorization_url: string;
  readonly redirect_uri: string;
  readonly state: string;
  readonly issuer: string;
}
