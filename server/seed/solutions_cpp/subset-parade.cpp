#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    vector<string> a(n);
    for (auto& s : a) cin >> s;
    string out;
    for (int m = 0; m < (1 << n); m++) {
        string line;
        for (int i = 0; i < n; i++)
            if (m >> i & 1) { if (!line.empty()) line += ' '; line += a[i]; }
        out += line.empty() ? "-" : line;
        out += '\n';
    }
    cout << out;
}
