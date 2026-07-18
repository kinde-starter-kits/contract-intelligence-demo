// Convex human-session auth: validate Kinde-issued JWTs so a signed-in human's
// token can authenticate calls to Convex (ctx.auth).
//
// This is the HUMAN web app's identity, kept deliberately separate from the
// crew's M2M API audience (KINDE_AUDIENCE) that the agent-auth component
// verifies against:
//   - `domain`        = the Kinde tenant issuer (KINDE_ISSUER_URL)
//   - `applicationID` = the web app's client id (KINDE_CLIENT_ID), which is the
//                       `aud` of the human's Kinde token.
//
// Convex requires every env var referenced here to be set on the deployment, so
// both must exist (dummy values are fine in test mode). Keeping KINDE_AUDIENCE
// out of this file lets the component's live-mode audience guard be exercised
// independently.
const authConfig = {
  providers: [
    {
      domain: process.env.KINDE_ISSUER_URL,
      applicationID: process.env.KINDE_CLIENT_ID
    }
  ]
};

export default authConfig;
