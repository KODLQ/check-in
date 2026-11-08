// iOS universal links: open /i/* (guest invites) and /c/* (co-host invites) in the app when installed.
export function GET() {
  const appId = `${process.env.APPLE_TEAM_ID ?? 'TEAMID'}.se.checkin.app`;
  return Response.json({
    applinks: { details: [{ appIDs: [appId], components: [{ '/': '/i/*' }, { '/': '/c/*' }] }] },
  });
}
