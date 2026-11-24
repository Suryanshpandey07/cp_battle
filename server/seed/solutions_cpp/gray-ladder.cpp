#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    int n; cin >> n;
    string out;
    for (int i = 0; i < (1 << n); i++) {
        int g = i ^ (i >> 1);
        for (int b = n - 1; b >= 0; b--) out += (g >> b & 1) ? '1' : '0';
        out += '\n';
    }
    cout << out;
}
