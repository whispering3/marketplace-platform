"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createSession, verifyAuth } from "@/lib/session";
import { hashPin, isValidPinFormat, verifyPin } from "@/lib/pin";
import { isShieldVerified } from "@/lib/captcha-sentinel";
import { registerUserFromForm, startLoginFromForm, completeLoginFromForm, verifyPgpLoginFromForm, markPhraseViewedFromForm, type AuthFlowResult } from "@/lib/auth-flow";
import { AUTH_FLOW_COOKIE, getPendingAuthState, pendingAuthCookieOptions, sealPendingAuthState } from "@/lib/auth-flow-cookie";

async function runAuth(form: FormData, flow: (form: FormData, pending?: Awaited<ReturnType<typeof getPendingAuthState>>) => Promise<AuthFlowResult>) {
  if (!await isShieldVerified()) return redirect("/");
  const result = await flow(form, await getPendingAuthState());
  const cookieStore = await cookies();
  if (result.pendingAuth) {
    cookieStore.set(AUTH_FLOW_COOKIE, await sealPendingAuthState(result.pendingAuth), pendingAuthCookieOptions);
  } else if (result.pendingAuth === null || result.session) {
    cookieStore.delete(AUTH_FLOW_COOKIE);
  }
  if (result.session) {
    const user = result.session;
    await createSession(user.userId, user.role, user.username, user.staffId || undefined, user.sessionVersion);
  }
  return redirect(result.redirectTo);
}

export async function registerAction(form: FormData) { return runAuth(form, registerUserFromForm); }
export async function loginAction(form: FormData) { return runAuth(form, startLoginFromForm); }
export async function completeLoginAction(form: FormData) { return runAuth(form, completeLoginFromForm); }
export async function verifyPGPTaskAction(form: FormData) { return runAuth(form, verifyPgpLoginFromForm); }
export async function markPhraseViewedAction(form: FormData) { return runAuth(form, markPhraseViewedFromForm); }

export async function updateSecuritySettingsAction(formData: FormData) {
   const session = await verifyAuth();
   const currentPin = formData.get("currentPin")?.toString();
   const newPin = formData.get("newPin")?.toString();

   if (!currentPin) return redirect("/market/dashboard/buyer?tab=settings&error=PinRequired");
   if (newPin && !isValidPinFormat(newPin)) {
      return redirect("/market/dashboard/buyer?tab=settings&error=InvalidNewPIN");
   }

   const user = await prisma.user.findUnique({ where: { id: session.userId as string } });
   if (!user || !verifyPin(currentPin, user.pin)) {
      return redirect("/market/dashboard/buyer?tab=settings&error=InvalidCurrentPIN");
   }

   await prisma.user.update({
      where: { id: user.id },
      data: {
         suicidePin: null,
         pin: newPin ? hashPin(newPin) : undefined,
         sessionVersion: newPin ? { increment: 1 } : undefined
      }
   });

   if (newPin) { const { deleteSession } = await import("@/lib/session"); return deleteSession(); }
   return redirect("/market/dashboard/buyer?tab=settings&success=SecurityUpdated");
}

export async function logoutAction() {
  const { deleteSession } = await import("@/lib/session");
  return deleteSession();
}
