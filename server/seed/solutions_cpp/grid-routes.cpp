#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

const ll MOD = 1000000007;
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int r, c; cin >> r >> c;
    vector<ll> dp(c, 0);
    for (int i = 0; i < r; i++) {
        string row; cin >> row;
        for (int j = 0; j < c; j++) {
            if (row[j] == '#') dp[j] = 0;
            else if (i == 0 && j == 0) dp[j] = 1;
            else if (j) dp[j] = (dp[j] + dp[j - 1]) % MOD;
        }
    }
    cout << dp[c - 1] << "\n";
}
