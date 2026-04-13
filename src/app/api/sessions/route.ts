/**
 * POST /api/sessions  → 创建新 Session，返回 { id, title, createdAt }
 * GET  /api/sessions  → 返回所有 Session 列表（按 updatedAt 倒序）
 */

import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST() {
  try {
    const session = await db.session.create({
      data: { title: "新对话" },
    })
    return NextResponse.json(session)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const sessions = await db.session.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id:        true,
        title:     true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(sessions)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
