#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    string s; cin >> s;
    int n = s.size();
    vector<ll> seen(2 * n + 1, 0);  // balance shifted by n
    seen[n] = 1;
    int bal = 0;
    ll ans = 0;
    for (char ch : s) {
        bal += ch == '1' ? 1 : -1;
        ans += seen[bal + n]++;
    }
    cout << ans << "\n";
}
