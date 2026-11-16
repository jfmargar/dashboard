// App de barra de menú del panel: enseña si está en marcha y cuántas sesiones trabajan o te esperan,
// y permite abrirlo, arrancarlo, pararlo o reiniciarlo. Por debajo controla el servicio de macOS
// (LaunchAgent) que mantiene el panel en marcha, así que cerrar esta app no para el panel.
import AppKit
import ServiceManagement

let serviceLabel = "com.jfmargar.dashboard"
let panelURL = URL(string: "http://localhost:4317")!
let stateURL = URL(string: "http://127.0.0.1:4317/api/state")!
let plistPath = NSString(string: "~/Library/LaunchAgents/\(serviceLabel).plist").expandingTildeInPath
let logPath = NSString(string: "~/Library/Logs/Dashboard.log").expandingTildeInPath
let tailscaleCandidates = ["/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/tailscale"]

struct PanelStatus {
    var running = false
    var working = 0
    var yours = 0
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var status = PanelStatus()
    private var tailnetURL: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        tailnetURL = readTailnetURL()
        render()
        refresh()
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
    }

    // Estado del panel: si responde y sus contadores de sesiones.
    private func refresh() {
        var request = URLRequest(url: stateURL)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            var next = PanelStatus()
            if let http = response as? HTTPURLResponse, http.statusCode == 200, let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let counts = json["counts"] as? [String: Any] ?? [:]
                next.running = true
                next.working = counts["working"] as? Int ?? 0
                next.yours = counts["yours"] as? Int ?? 0
            }
            DispatchQueue.main.async {
                self?.status = next
                self?.render()
            }
        }.resume()
    }

    private func render() {
        guard let button = statusItem.button else { return }
        let symbol = status.running ? "building.2.fill" : "building.2"
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Dashboard")
        button.image?.isTemplate = true
        button.appearsDisabled = !status.running
        // Junto al icono, cuántas sesiones trabajan y cuántas te esperan
        button.title = status.running && (status.working + status.yours) > 0 ? " \(status.working)·\(status.yours)" : ""
        button.imagePosition = .imageLeading
        statusItem.menu = buildMenu()
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        let header = status.running
            ? "Panel en marcha · \(status.working) trabajando · \(status.yours) te toca"
            : "Panel parado"
        let headerItem = NSMenuItem(title: header, action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)
        menu.addItem(.separator())

        menu.addItem(item("Abrir el panel", #selector(openPanel), key: "o", enabled: status.running))
        if let url = tailnetURL {
            menu.addItem(item("Copiar la dirección para la tablet", #selector(copyTailnetURL), enabled: status.running))
            let hint = NSMenuItem(title: url, action: nil, keyEquivalent: "")
            hint.isEnabled = false
            menu.addItem(hint)
        }
        menu.addItem(.separator())

        if status.running {
            menu.addItem(item("Reiniciar", #selector(restartPanel), key: "r"))
            menu.addItem(item("Parar", #selector(stopPanel)))
        } else {
            menu.addItem(item("Arrancar", #selector(startPanel), key: "s"))
        }
        menu.addItem(item("Ver el registro", #selector(openLog)))
        menu.addItem(.separator())

        let login = item("Mostrar el icono al iniciar sesión", #selector(toggleLoginItem))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(item("Quitar el icono", #selector(quit), key: "q"))
        return menu
    }

    private func item(_ title: String, _ action: Selector, key: String = "", enabled: Bool = true) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: enabled ? action : nil, keyEquivalent: key)
        menuItem.target = self
        menuItem.isEnabled = enabled
        return menuItem
    }

    // Acciones

    @objc private func openPanel() {
        NSWorkspace.shared.open(panelURL)
    }

    @objc private func copyTailnetURL() {
        guard let url = tailnetURL else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }

    @objc private func startPanel() {
        let domain = "gui/\(getuid())"
        // Si el servicio no está cargado se carga; si lo está, se arranca
        if launchctl(["bootstrap", domain, plistPath]) != 0 {
            _ = launchctl(["kickstart", "\(domain)/\(serviceLabel)"])
        }
        refreshSoon()
    }

    @objc private func stopPanel() {
        // Descargar el servicio lo para hasta que se vuelva a arrancar o hasta el próximo inicio de sesión
        _ = launchctl(["bootout", "gui/\(getuid())/\(serviceLabel)"])
        refreshSoon()
    }

    @objc private func restartPanel() {
        _ = launchctl(["kickstart", "-k", "gui/\(getuid())/\(serviceLabel)"])
        refreshSoon()
    }

    @objc private func openLog() {
        NSWorkspace.shared.open(URL(fileURLWithPath: logPath))
    }

    @objc private func toggleLoginItem() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "No se pudo cambiar el inicio de sesión"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
        render()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // Utilidades

    private func refreshSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.refresh() }
    }

    @discardableResult
    private func launchctl(_ arguments: [String]) -> Int32 {
        run("/bin/launchctl", arguments).status
    }

    // Dirección del Mac en Tailscale, para abrir el panel desde la tablet.
    private func readTailnetURL() -> String? {
        guard let bin = tailscaleCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { return nil }
        let result = run(bin, ["status", "--json"])
        guard result.status == 0,
              let json = try? JSONSerialization.jsonObject(with: result.output) as? [String: Any],
              let me = json["Self"] as? [String: Any],
              var name = me["DNSName"] as? String, !name.isEmpty else { return nil }
        if name.hasSuffix(".") { name.removeLast() }
        return "https://\(name)"
    }

    private func run(_ path: String, _ arguments: [String]) -> (status: Int32, output: Data) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            return (-1, Data())
        }
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, output)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
