import { getResponseError } from "@/lib/api-client";

export type AppUser = {
  id: string;
  username: string;
  createdAt: string;
};

export async function getCurrentUser() {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { user: AppUser | null };
}

export async function login(input: { username: string; password: string }) {
  return submitAuth("/api/auth/login", input);
}

export async function register(input: { username: string; password: string }) {
  return submitAuth("/api/auth/register", input);
}

export async function logout() {
  const response = await fetch("/api/auth/logout", {
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }
}

async function submitAuth(
  url: string,
  input: { username: string; password: string }
) {
  const response = await fetch(url, {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { user: AppUser };
}
