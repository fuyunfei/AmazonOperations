/**
 * GET    /api/sessions/:id  → 返回 Session 信息 + 最近 40 条消息（20 轮 user+assistant）
 * PATCH  /api/sessions/:id  → 重命名 Session（body: { title: string }）
 * DELETE /api/sessions/:id  → 删除 Session 及所有消息（级联）
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await db.session.findUnique({
      where: { id: params.id },
    })
    if (!session) {
      return NextResponse.json({ error: "Session 不存在" }, { status: 404 })
    }

    const messages = await db.message.findMany({
      where:   { sessionId: params.id },
      orderBy: { createdAt: "asc" },
      take:    40,   // 最近 20 轮 user+assistant 对
    })

    // toolCalls は DB に JSON 文字列で保存されるため、返却前に parse する
    const parsedMessages = messages.map(m => ({
      ...m,
      toolCalls: m.toolCalls
        ? (() => { try { return JSON.parse(m.toolCalls as string) } catch { return [] } })()
        : null,
    }))

    return NextResponse.json({ ...session, messages: parsedMessages })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { title } = await req.json() as { title?: string }
    if (!title?.trim()) {
      return NextResponse.json({ error: "title 不能为空" }, { status: 400 })
    }

    const session = await db.session.update({
      where: { id: params.id },
      data:  { title: title.trim() },
    })
    return NextResponse.json(session)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await db.session.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
