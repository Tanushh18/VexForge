import { createContext, useContext, useState, useCallback } from "react";
import { api } from "./services/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("vf_token"));
  const [name, setName] = useState(() => localStorage.getItem("vf_name") || "Founder");

  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    localStorage.setItem("vf_token", res.token);
    localStorage.setItem("vf_name", res.name);
    setToken(res.token);
    setName(res.name);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("vf_token");
    localStorage.removeItem("vf_name");
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, name, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
