#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, m; cin >> n >> m;
    vector<vector<pair<int, ll>>> adj(n + 1);
    for (int i = 0; i < m; i++) {
        int u, v; ll w; cin >> u >> v >> w;
        adj[u].push_back({v, w});
        adj[v].push_back({u, w});
    }
    const ll INF = LLONG_MAX;
    vector<ll> dist(n + 1, INF);
    priority_queue<pair<ll, int>, vector<pair<ll, int>>, greater<>> pq;
    dist[1] = 0;
    pq.push({0, 1});
    while (!pq.empty()) {
        auto [d, u] = pq.top(); pq.pop();
        if (d > dist[u]) continue;
        for (auto [v, w] : adj[u])
            if (d + w < dist[v]) { dist[v] = d + w; pq.push({dist[v], v}); }
    }
    int q; cin >> q;
    string out;
    while (q--) {
        int t; cin >> t;
        out += dist[t] == INF ? "-1\n" : to_string(dist[t]) + "\n";
    }
    cout << out;
}
