import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { safeStorage } from "@/lib/storage";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = anon, obj = logged in
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = safeStorage.get("pos_token");
    if (!t) { setUser(false); setLoading(false); return; }
    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => { safeStorage.remove("pos_token"); setUser(false); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    safeStorage.set("pos_token", data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    safeStorage.remove("pos_token");
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
