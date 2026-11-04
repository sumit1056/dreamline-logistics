import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "../db.server";
import { requireAdmin } from "../session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const idStr = url.searchParams.get("id");
  const id = parseInt(idStr || "0", 10);

  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ error: "Invalid receipt ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, imageUrl: true },
  });

  if (!expense || !expense.imageUrl) {
    return new Response(JSON.stringify({ error: "No receipt image found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ id: expense.id, imageUrl: expense.imageUrl }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
