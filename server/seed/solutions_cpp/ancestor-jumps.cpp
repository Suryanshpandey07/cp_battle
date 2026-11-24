#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    int LOG = 1;
    while ((1 << LOG) <= n) LOG++;  // bit_length(n)
    LOG = max(1, LOG);
    vector<vector<int>> up(LOG, vector<int>(n + 1, 0));
    for (int v = 2; v <= n; v++) cin >> up[0][v];
    for (int j = 1; j < LOG; j++)
        for (int v = 0; v <= n; v++) up[j][v] = up[j - 1][up[j - 1][v]];
    int q; cin >> q;
    string out;
    while (q--) {
        ll v, k; cin >> v >> k;
        if (k >= (1LL << LOG)) { out += "-1\n"; continue; }
        int j = 0;
        while (k && v) {
            if (k & 1) v = up[j][v];
            k >>= 1;
            j++;
        }
        out += v ? to_string(v) + "\n" : "-1\n";
    }
    cout << out;
}
