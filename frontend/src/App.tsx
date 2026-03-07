import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import DatabaseDetail from "./pages/DatabaseDetail";
import DatabaseConnections from "./pages/DatabaseConnections";
import Settings from "./pages/Settings";
import SQLEditor from "./pages/SQLEditor";
import Tables from "./pages/Tables";
import Containers from "./pages/Containers";
import Monitoring from "./pages/Monitoring";
import WebServer from "./pages/WebServer";
import Branches from "./pages/branches/Branches";
import Backup from "./pages/Backup";
import Security from "./pages/Security";
import Notifications from "./pages/Notifications";
import DatabaseNotifications from "./pages/DatabaseNotifications";
import Users from "./pages/Users";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Profile from "./pages/Profile";
import AuthLayout from "./components/auth/AuthLayout";
import Sidebar from "./components/dashboard/sidebar";
import MobileDock from "./components/dashboard/MobileDock";
import UpdateOverlay from "./components/dashboard/UpdateOverlay";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./components/theme-provider";
import { DatabaseProvider } from "./context/DatabaseContext";
import { ProjectProvider } from "./context/ProjectContext";
import { AuthProvider } from "./context/AuthContext";
import AuthGuard from "./components/auth/AuthGuard";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="baseful-theme">
      <Router>
        <AuthProvider>
          <ProjectProvider>
            <DatabaseProvider>
              <Routes>
                {/* Public Routes */}
                <Route element={<AuthLayout />}>
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                </Route>

                {/* Protected Routes */}
                <Route
                  path="/*"
                  element={
                    <AuthGuard>
                      <UpdateOverlay />
                      <Toaster richColors />
                      <div className="bg-background h-dvh w-full flex flex-row">
                        {/* Desktop Sidebar - hidden on mobile */}
                        <div className="hidden md:block">
                          <Sidebar />
                        </div>

                        <main className="p-0 md:p-2 bg-background flex h-full flex-1 min-w-0">
                          <div className="bg-card overflow-y-auto overflow-x-hidden md:border border-border md:rounded-md h-full w-full">
                            <Routes>
                              <Route path="/" element={<Home />} />
                              <Route path="/about" element={<About />} />
                              <Route
                                path="/db/:id/dashboard"
                                element={<DatabaseDetail />}
                              />
                              <Route
                                path="/db/:id/branches"
                                element={<Branches />}
                              />
                              <Route
                                path="/db/:id/integrations"
                                element={<DatabaseDetail />}
                              />
                              <Route
                                path="/db/:id/settings"
                                element={<Settings />}
                              />
                              <Route
                                path="/db/:id/overview"
                                element={<DatabaseDetail />}
                              />
                              <Route
                                path="/db/:id/monitoring"
                                element={<Monitoring />}
                              />
                              <Route
                                path="/monitoring"
                                element={<Monitoring />}
                              />
                              <Route
                                path="/db/:id/sql-editor"
                                element={<SQLEditor />}
                              />
                              <Route
                                path="/db/:id/connections"
                                element={<DatabaseConnections />}
                              />
                              <Route
                                path="/db/:id/tables"
                                element={<Tables />}
                              />
                              <Route
                                path="/db/:id/containers"
                                element={<Containers />}
                              />
                              <Route
                                path="/containers"
                                element={<Containers />}
                              />
                              <Route
                                path="/db/:id/web-server"
                                element={<WebServer />}
                              />
                              <Route
                                path="/web-server"
                                element={<WebServer />}
                              />
                              <Route
                                path="/db/:id/notifications"
                                element={<DatabaseNotifications />}
                              />
                              <Route
                                path="/notifications"
                                element={<Notifications />}
                              />
                              <Route
                                path="/db/:id/backup"
                                element={<Backup />}
                              />
                              <Route
                                path="/db/:id/security"
                                element={<Security />}
                              />
                              <Route path="/security" element={<Security />} />
                              <Route path="/users" element={<Users />} />
                              <Route
                                path="/settings/profile"
                                element={<Profile />}
                              />
                            </Routes>
                          </div>
                        </main>

                        {/* Mobile Dock - hidden on desktop */}
                        <MobileDock />
                      </div>
                    </AuthGuard>
                  }
                />
              </Routes>
            </DatabaseProvider>
          </ProjectProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
