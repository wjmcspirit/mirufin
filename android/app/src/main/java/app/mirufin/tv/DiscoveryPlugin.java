package app.mirufin.tv;

import android.content.Context;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import org.json.JSONObject;

@CapacitorPlugin(name = "Discovery")
public class DiscoveryPlugin extends Plugin {
    private static final int PORT = 7359;
    private static final int TIMEOUT_MS = 2500;

    @PluginMethod
    public void findServers(PluginCall call) {
        WifiManager.MulticastLock lock = multicastLock();
        if (lock != null) lock.acquire();
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(0));
            byte[] payload = "Who is JellyfinServer?".getBytes(StandardCharsets.UTF_8);
            for (InetAddress host : broadcastAddresses()) {
                try {
                    socket.send(new DatagramPacket(payload, payload.length, host, PORT));
                } catch (Exception ignored) {
                    /* Try the next broadcast address. */
                }
            }

            LinkedHashMap<String, JSObject> found = new LinkedHashMap<>();
            long deadline = System.currentTimeMillis() + TIMEOUT_MS;
            byte[] buffer = new byte[8192];
            while (System.currentTimeMillis() < deadline) {
                socket.setSoTimeout((int) Math.max(1, deadline - System.currentTimeMillis()));
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException done) {
                    break;
                }
                remember(found, new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8));
            }

            JSObject result = new JSObject();
            result.put("servers", new JSArray(found.values()));
            call.resolve(result);
        } catch (Exception error) {
            call.resolve(new JSObject().put("servers", new JSArray()));
        } finally {
            if (socket != null) socket.close();
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    private WifiManager.MulticastLock multicastLock() {
        Context context = getContext();
        if (context == null) return null;
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) return null;
        WifiManager.MulticastLock lock = wifi.createMulticastLock("mirufin-discovery");
        lock.setReferenceCounted(false);
        return lock;
    }

    private void remember(LinkedHashMap<String, JSObject> found, String message) {
        try {
            JSONObject body = new JSONObject(message);
            String address = cleanAddress(body.optString("Address", ""));
            if (address.isEmpty()) return;
            String id = body.optString("Id", address);
            if (found.containsKey(id)) return;
            JSObject server = new JSObject();
            server.put("name", body.optString("Name", "Jellyfin"));
            server.put("address", address);
            server.put("id", id);
            found.put(id, server);
        } catch (Exception ignored) {
            /* Ignore replies that are not Jellyfin's discovery message. */
        }
    }

    private String cleanAddress(String input) {
        String address = input.trim();
        while (address.endsWith("/")) address = address.substring(0, address.length() - 1);
        if (address.toLowerCase().endsWith("/web")) address = address.substring(0, address.length() - 4);
        return address;
    }

    private InetAddress[] broadcastAddresses() {
        LinkedHashMap<String, InetAddress> targets = new LinkedHashMap<>();
        try {
            targets.put("255.255.255.255", InetAddress.getByName("255.255.255.255"));
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                for (var address : network.getInterfaceAddresses()) {
                    if (!(address.getAddress() instanceof Inet4Address)) continue;
                    InetAddress broadcast = address.getBroadcast();
                    if (broadcast != null) targets.put(broadcast.getHostAddress(), broadcast);
                }
            }
        } catch (Exception ignored) {
            /* The global broadcast is still worth trying. */
        }
        return targets.values().toArray(new InetAddress[0]);
    }
}
