import { ApiError, LedgerService } from "./service.ts";
export async function dispatchLedger(
  service: LedgerService,
  method: string,
  path: string[],
  body: Record<string, any>,
) {
  if (path[0] === "invites" && path.length === 2) {
    if (method === "GET")
      return { data: await service.inviteInfo(path[1]), status: 200 };
    if (method === "POST")
      return { data: await service.join(path[1]), status: 200 };
  }
  if (path[0] === "trips") {
    if (path.length === 1) {
      if (method === "GET")
        return { data: await service.listTrips(), status: 200 };
      if (method === "POST")
        return { data: await service.createTrip(body), status: 201 };
    }
    const id = path[1],
      entity = path[2],
      entityId = path[3];
    if (path.length === 2) {
      if (method === "GET")
        return { data: await service.snapshot(id), status: 200 };
      if (method === "PATCH")
        return { data: await service.updateTrip(id, body), status: 200 };
    }
    if (entity === "settlement" && path.length === 3 && method === "GET") {
      const s = await service.snapshot(id);
      return {
        data: {
          members: s.members,
          transfers: s.transfers,
          repayments: s.repayments,
          version: s.trip.version,
        },
        status: 200,
      };
    }
    if (entity === "invite" && path.length === 3 && method === "POST")
      return { data: await service.resetInvite(id, body), status: 200 };
    if (entity === "expenses" || entity === "repayments") {
      if (
        (method === "POST" && path.length === 3) ||
        (method === "PATCH" && path.length === 4)
      )
        return {
          data:
            entity === "expenses"
              ? await service.saveExpense(id, body, entityId)
              : await service.saveRepayment(id, body, entityId),
          status: 200,
        };
      if (method === "DELETE" && path.length === 4)
        return {
          data: await service.remove(id, body, entity, entityId),
          status: 200,
        };
    }
  }
  throw new ApiError(404, "接口不存在");
}
