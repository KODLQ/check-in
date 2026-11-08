// iOS universal links: open /i/* in the app when installed (spec: open in app).
export function GET() {
  const appId = `${process.env.APPLE_TEAM_ID ?? 'TEAMID'}.se.checkin.app`;
  return Response.json({
    applinks: { details: [{ appIDs: [appId], components: [{ '/': '/i/*' }] }] },
  });
}
