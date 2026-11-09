"use server";

import { issueSentinelToken } from "@/lib/sentinel-token";

import { cookies } from "next/headers";
import { getShieldSession, updateShieldSession, generateNewCaptcha, initializeShieldCookie } from "@/lib/captcha-sentinel";
import { redirect } from "next/navigation";

export async function initializeSentinelAction() {
  const sealed = await initializeShieldCookie();
  const cookieStore = await cookies();
  cookieStore.set("os_gate_v2", sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  redirect("/");
}

export async function verifySentinelAction(formData: FormData) {
  // 0. Anti-Automation Delay (frustrate OCR bots)
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

  const userInput = formData.get("captcha")?.toString().toUpperCase();
  const session = await getShieldSession();

  if (!session) {
    return redirect("/");
  }

  // 1. Check if blocked
  if (session.blockedUntil && session.blockedUntil > Date.now()) {
    const remaining = Math.ceil((session.blockedUntil - Date.now()) / 1000);
    redirect(`/?error=GATEWAY BLOCKED: Wait ${remaining}s.`);
  }

  // 2. Validate
  if (userInput === session.captcha) {
    // SUCCESS
    const cookieStore = await cookies();
    cookieStore.set("os_sentinel_v2", await issueSentinelToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 2, // 2 hours
      sameSite: 'strict',
      path: '/'
    });

    // Clear session and redirect
    cookieStore.delete("os_gate_v2");
    redirect("/auth/login");
  } else {
    // FAILURE
    const newCount = session.failedCount + 1;

    if (newCount >= 3) {
      await updateShieldSession({
        failedCount: 0,
        blockedUntil: Date.now() + 60000
      });
      redirect("/?error=BRUTE FORCE DETECTED: 1 minute lockdown initiated.");
    } else {
      await updateShieldSession({ failedCount: newCount });
      await generateNewCaptcha(); // Rotate on fail
      redirect(`/?error=INCORRECT CAPTCHA. Attempts remaining: ${3 - newCount}`);
    }
  }
}
