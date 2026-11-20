"""
Problem Bank: Curated official Codeforces problems with verified test suites.
These problems provide complete statements, input/output specifications, sample tests,
and hidden test cases for automated competitive programming battles.
"""

from typing import Dict, Any, List, Optional
import random

PROBLEMS: Dict[str, Dict[str, Any]] = {
    "4A": {
        "problem_code": "4A",
        "contest_id": 4,
        "index": "A",
        "problem_name": "Watermelon",
        "problem_rating": 800,
        "tags": ["brute force", "math"],
        "problem_url": "https://codeforces.com/problemset/problem/4/A",
        "time_limit_ms": 1000,
        "memory_limit_mb": 64,
        "description": """
### Problem Statement
One hot summer day Pete and his friend Billy decided to buy a watermelon. They chose the biggest and the ripest one, in their opinion. After that the watermelon was weighed, and the scales showed $w$ kilos. They rushed home, dying of thirst, and decided to divide the berry, however they faced a hard problem.

Pete and Billy are great fans of even numbers, that's why they want to divide the watermelon in such a way that each of the two parts weighs even number of kilos, at the same time it is not obligatory that the parts are equal. The boys are extremely tired and want to start their meal as soon as possible, that's why you should help them and find out, if they can divide the watermelon in the way they want. For sure, each of them should get a part of positive weight.

### Input
The first (and the only) input line contains integer number $w$ ($1 \\le w \\le 100$) — the weight of the watermelon bought by the boys.

### Output
Print `YES`, if the boys can divide the watermelon into two parts, each of them weighing even number of kilos; and `NO` in the opposite case.

### Note
For example, the boys can divide the watermelon into two parts of 2 and 6 kilos respectively (another variant — two parts of 4 and 4 kilos).
        """.strip(),
        "sample_cases": [
            {"input": "8\n", "output": "YES\n", "explanation": "Can be split into 4 and 4 or 2 and 6."},
            {"input": "2\n", "output": "NO\n", "explanation": "Can only be split into 1 and 1, neither is even."}
        ],
        "hidden_cases": [
            {"input": "1\n", "output": "NO\n"},
            {"input": "3\n", "output": "NO\n"},
            {"input": "4\n", "output": "YES\n"},
            {"input": "5\n", "output": "NO\n"},
            {"input": "6\n", "output": "YES\n"},
            {"input": "10\n", "output": "YES\n"},
            {"input": "12\n", "output": "YES\n"},
            {"input": "99\n", "output": "NO\n"},
            {"input": "100\n", "output": "YES\n"}
        ]
    },
    "71A": {
        "problem_code": "71A",
        "contest_id": 71,
        "index": "A",
        "problem_name": "Way Too Long Words",
        "problem_rating": 800,
        "tags": ["strings"],
        "problem_url": "https://codeforces.com/problemset/problem/71/A",
        "time_limit_ms": 1000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
Sometimes some words like "localization" or "internationalization" are so long that writing them many times in one text is quite tiresome.

Let's consider a word **too long**, if its length is **strictly more than 10 characters**. All too long words should be replaced with a special abbreviation.

This abbreviation is made like this: we write down the first and the last letter of a word and between them we write the number of letters between the first and the last letters. That number is in decimal system and doesn't contain any leading zeroes.

Thus, "localization" will be spelt as "l10n", and "internationalization» will be spelt as "i18n".

You are suggested to automatize the process of changing the words with abbreviations. At that all too long words should be replaced by the abbreviation and the words that are not too long should not undergo any changes.

### Input
The first line contains an integer $n$ ($1 \\le n \\le 100$). Each of the following $n$ lines contains one word. All the words consist of lowercase Latin letters and possess lengths of from 1 to 100 characters.

### Output
Print $n$ lines. The $i$-th line should contain the result of replacing of the $i$-th word from the input data.
        """.strip(),
        "sample_cases": [
            {
                "input": "4\nword\nlocalization\ninternationalization\npneumonoultramicroscopicsilicovolcanoconiosis\n",
                "output": "word\nl10n\ni18n\np43s\n",
                "explanation": "Words strictly longer than 10 characters are abbreviated."
            }
        ],
        "hidden_cases": [
            {
                "input": "3\na\nabcdefghij\nabcdefghijk\n",
                "output": "a\nabcdefghij\na9k\n"
            },
            {
                "input": "2\nsupercalifragilisticexpialidocious\ncodeforces\n",
                "output": "s32s\ncodeforces\n"
            }
        ]
    },
    "231A": {
        "problem_code": "231A",
        "contest_id": 231,
        "index": "A",
        "problem_name": "Team",
        "problem_rating": 800,
        "tags": ["brute force", "greedy"],
        "problem_url": "https://codeforces.com/problemset/problem/231/A",
        "time_limit_ms": 2000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
One day three best friends Petya, Vasya and Tonya decided to form a team and take part in programming contests. Participants are usually offered several problems during programming contests. Long before the start the friends decided that they will implement a problem if at least two of them are sure about the solution. Otherwise, the friends won't write the problem's solution.

This contest offers $n$ problems to the participants. For each problem we know, which friend is sure about the solution. Help the friends find the number of problems for which they will write a solution.

### Input
The first input line contains a single integer $n$ ($1 \\le n \\le 1000$) — the number of problems in the contest. Then $n$ lines contain three integers each, each integer is either 0 or 1. If the first number in the line equals 1, then Petya is sure about the problem's solution, otherwise he isn't sure. The second number shows Vasya's view on the solution, the third number shows Tonya's view. The numbers on the lines are separated by spaces.

### Output
Print a single integer — the number of problems the friends will implement on the contest.
        """.strip(),
        "sample_cases": [
            {
                "input": "3\n1 1 0\n1 1 1\n1 0 0\n",
                "output": "2\n",
                "explanation": "In the 1st and 2nd problems at least 2 friends are sure."
            },
            {
                "input": "2\n1 0 0\n0 1 1\n",
                "output": "1\n",
                "explanation": "Only in the 2nd problem at least 2 friends are sure."
            }
        ],
        "hidden_cases": [
            {"input": "1\n0 0 0\n", "output": "0\n"},
            {"input": "1\n1 1 1\n", "output": "1\n"},
            {"input": "4\n0 1 0\n1 0 1\n0 1 1\n0 0 1\n", "output": "2\n"},
            {"input": "5\n1 1 0\n0 1 1\n1 0 1\n1 1 1\n0 0 0\n", "output": "4\n"}
        ]
    },
    "158A": {
        "problem_code": "158A",
        "contest_id": 158,
        "index": "A",
        "problem_name": "Next Round",
        "problem_rating": 800,
        "tags": ["special problem"],
        "problem_url": "https://codeforces.com/problemset/problem/158/A",
        "time_limit_ms": 3000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
"Contestant who earns a score equal to or greater than the $k$-th place finisher's score will advance to the next round, as long as the contestant earns a positive score..." — an excerpt from contest rules.

A total of $n$ participants took part in the contest ($n \\ge k$), and you already know their scores. Calculate how many participants will advance to the next round.

### Input
The first line contains two integers $n$ and $k$ ($1 \\le k \\le n \\le 50$) separated by a single space.
The second line contains $n$ space-separated integers $a_1, a_2, \\dots, a_n$ ($0 \\le a_i \\le 100$), where $a_i$ is the score earned by the participant who got the $i$-th place. The given sequence is non-increasing (that is, for all $i$ from 1 to $n-1$ the following condition is fulfilled: $a_i \\ge a_{i+1}$).

### Output
Output the number of participants who advance to the next round.
        """.strip(),
        "sample_cases": [
            {
                "input": "8 5\n10 9 8 7 7 7 5 5\n",
                "output": "6\n",
                "explanation": "5th place score is 7. Six participants scored at least 7 and strictly positive."
            },
            {
                "input": "4 2\n0 0 0 0\n",
                "output": "0\n",
                "explanation": "Nobody scored a positive score."
            }
        ],
        "hidden_cases": [
            {"input": "1 1\n1\n", "output": "1\n"},
            {"input": "1 1\n0\n", "output": "0\n"},
            {"input": "5 3\n3 2 1 0 0\n", "output": "3\n"},
            {"input": "5 1\n1 1 1 1 1\n", "output": "5\n"}
        ]
    },
    "282A": {
        "problem_code": "282A",
        "contest_id": 282,
        "index": "A",
        "problem_name": "Bit++",
        "problem_rating": 800,
        "tags": ["implementation"],
        "problem_url": "https://codeforces.com/problemset/problem/282/A",
        "time_limit_ms": 1000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
The classic programming language of Bitland is Bit++. A language that is so peculiar and complicated.

The language is that peculiar as it has the only one variable, called $x$. Also, there are two operations:
- Operation `++` increases the value of variable $x$ by 1.
- Operation `--` decreases the value of variable $x$ by 1.

A statement in Bit++ is a sequence, consisting of exactly one operation and one variable $x$. The statement is written without spaces: `++X`, `X++`, `--X` or `X--`.
Executing a statement means applying the operation it contains.

Initially, $x = 0$. Given a program in Bit++, execute it and find the final value of $x$.

### Input
The first line contains a single integer $n$ ($1 \\le n \\le 150$) — the number of statements in the program.
Next $n$ lines contain one statement each.

### Output
Print a single integer — the final value of $x$.
        """.strip(),
        "sample_cases": [
            {
                "input": "1\n++X\n",
                "output": "1\n",
                "explanation": "Initial x is 0. Incremented to 1."
            },
            {
                "input": "2\nX++\n--X\n",
                "output": "0\n",
                "explanation": "x becomes 1 then 0."
            }
        ],
        "hidden_cases": [
            {"input": "3\n++X\n++X\n++X\n", "output": "3\n"},
            {"input": "4\n--X\nX--\n++X\nX++\n", "output": "0\n"},
            {"input": "2\n--X\n--X\n", "output": "-2\n"}
        ]
    },
    "50A": {
        "problem_code": "50A",
        "contest_id": 50,
        "index": "A",
        "problem_name": "Domino piling",
        "problem_rating": 800,
        "tags": ["greedy", "math"],
        "problem_url": "https://codeforces.com/problemset/problem/50/A",
        "time_limit_ms": 2000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
You are given a rectangular board of $M \\times N$ squares. You are also given a limitless number of standard domino pieces of $2 \\times 1$ squares. You are allowed to rotate the pieces. You are asked to place as many dominoes as possible on the board so as to meet the following conditions:
1. Each domino completely covers two squares.
2. No two dominoes overlap.
3. Each domino lies entirely inside the board. It is allowed to touch the edges of the board.

Find the maximum number of dominoes, which can be placed under these restrictions.

### Input
In a single line you are given two integers $M$ and $N$ ($1 \\le M \\le N \\le 16$).

### Output
Output one number — the maximal number of dominoes, which can be placed.
        """.strip(),
        "sample_cases": [
            {"input": "2 4\n", "output": "4\n", "explanation": "2*4 = 8 squares. 8 / 2 = 4 dominoes."},
            {"input": "3 3\n", "output": "4\n", "explanation": "3*3 = 9 squares. 9 / 2 = 4 dominoes."}
        ],
        "hidden_cases": [
            {"input": "1 1\n", "output": "0\n"},
            {"input": "1 2\n", "output": "1\n"},
            {"input": "16 16\n", "output": "128\n"},
            {"input": "5 7\n", "output": "17\n"}
        ]
    },
    "263A": {
        "problem_code": "263A",
        "contest_id": 263,
        "index": "A",
        "problem_name": "Beautiful Matrix",
        "problem_rating": 800,
        "tags": ["implementation"],
        "problem_url": "https://codeforces.com/problemset/problem/263/A",
        "time_limit_ms": 2000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
You've got a $5 \\times 5$ matrix, consisting of 24 zeroes and a single number one. Let's index the matrix rows by numbers from 1 to 5 from top to bottom, let's index the matrix columns by numbers from 1 to 5 from left to right.

In one move, you are allowed to apply one of the two following transformations to the matrix:
- Swap two neighboring matrix rows.
- Swap two neighboring matrix columns.

You consider a matrix beautiful if the single number one of the matrix is located in its middle (in the cell that is on the intersection of the third row and the third column). Count the minimum number of moves needed to make the matrix beautiful.

### Input
The input consists of five lines, each line contains five integers: the $j$-th integer in the $i$-th line of the input represents the element of the matrix that is located on the intersection of the $i$-th row and the $j$-th column. It is guaranteed that the matrix consists of 24 zeroes and a single number one.

### Output
Print a single number — the minimum number of moves needed to make the matrix beautiful.
        """.strip(),
        "sample_cases": [
            {
                "input": "0 0 0 0 0\n0 0 0 0 1\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n",
                "output": "3\n",
                "explanation": "Cell is at (2, 5). Moves: |2 - 3| + |5 - 3| = 1 + 2 = 3."
            }
        ],
        "hidden_cases": [
            {"input": "0 0 0 0 0\n0 0 0 0 0\n0 0 1 0 0\n0 0 0 0 0\n0 0 0 0 0\n", "output": "0\n"},
            {"input": "1 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n", "output": "4\n"},
            {"input": "0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 1\n", "output": "4\n"}
        ]
    },
    "112A": {
        "problem_code": "112A",
        "contest_id": 112,
        "index": "A",
        "problem_name": "Petya and Strings",
        "problem_rating": 800,
        "tags": ["implementation", "strings"],
        "problem_url": "https://codeforces.com/problemset/problem/112/A",
        "time_limit_ms": 2000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
Little Petya loves presents. His mum bought him two strings of the same size for his birthday. The strings consist of uppercase and lowercase Latin letters. Now Petya wants to compare those two strings lexicographically. The letters' case does not matter, that is an uppercase letter is considered equivalent to the corresponding lowercase letter. Help Petya perform the comparison.

### Input
Each of the first two lines contains a bought string. The strings' lengths range from 1 to 100 inclusive. It is guaranteed that the strings are of the same length and also consist of uppercase and lowercase Latin letters.

### Output
If the first string is less than the second one, print "-1". If the second string is less than the first one, print "1". If the strings are equal, print "0". Note that the letters' case is not taken into consideration when the strings are compared.
        """.strip(),
        "sample_cases": [
            {"input": "aaaa\naaaa\n", "output": "0\n", "explanation": "Equal strings."},
            {"input": "abs\nAbz\n", "output": "-1\n", "explanation": "'abs' < 'abz'."},
            {"input": "abcdefg\nAbCdEfF\n", "output": "1\n", "explanation": "'abcdefg' > 'abcdef'"}
        ],
        "hidden_cases": [
            {"input": "a\nA\n", "output": "0\n"},
            {"input": "Z\na\n", "output": "1\n"},
            {"input": "Codeforces\ncodeForces\n", "output": "0\n"},
            {"input": "abc\nabd\n", "output": "-1\n"}
        ]
    },
    "617A": {
        "problem_code": "617A",
        "contest_id": 617,
        "index": "A",
        "problem_name": "Elephant",
        "problem_rating": 800,
        "tags": ["math"],
        "problem_url": "https://codeforces.com/problemset/problem/617/A",
        "time_limit_ms": 1000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
An elephant decided to visit his friend. It turned out that the elephant's house is located at point 0 and his friend's house is located at point $x$ ($x > 0$) of the coordinate line. In one step the elephant can move 1, 2, 3, 4 or 5 positions forward. Determine, what is the minimum number of steps he need to make in order to get to his friend's house.

### Input
The first line of the input contains an integer $x$ ($1 \\le x \\le 1\\,000\\,000$) — the coordinate of the friend's house.

### Output
Print the minimum number of steps that elephant needs to make to get from point 0 to point $x$.
        """.strip(),
        "sample_cases": [
            {"input": "5\n", "output": "1\n", "explanation": "One step of length 5 is enough."},
            {"input": "12\n", "output": "3\n", "explanation": "Two steps of 5 and one step of 2."}
        ],
        "hidden_cases": [
            {"input": "1\n", "output": "1\n"},
            {"input": "4\n", "output": "1\n"},
            {"input": "6\n", "output": "2\n"},
            {"input": "15\n", "output": "3\n"},
            {"input": "1000000\n", "output": "200000\n"}
        ]
    },
    "977A": {
        "problem_code": "977A",
        "contest_id": 977,
        "index": "A",
        "problem_name": "Wrong Subtraction",
        "problem_rating": 800,
        "tags": ["implementation"],
        "problem_url": "https://codeforces.com/problemset/problem/977/A",
        "time_limit_ms": 1000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
Little girl Tanya is learning how to decrease a number by one, but she does it wrong with a number consisting of two or more digits. Tanya subtracts one from a number by the following algorithm:
- if the last digit of the number is non-zero, she decreases the number by one;
- if the last digit of the number is zero, she divides the number by 10 (i.e. removes the last digit).

You are given an integer number $n$. Tanya will subtract one from it $k$ times. Your task is to print the result after all $k$ subtractions.

### Input
The first line of the input contains two integer numbers $n$ and $k$ ($2 \\le n \\le 10^9$, $1 \\le k \\le 50$).

### Output
Print one integer number — the result of decreasing $n$ by one $k$ times.
        """.strip(),
        "sample_cases": [
            {"input": "512 4\n", "output": "50\n", "explanation": "512 -> 511 -> 510 -> 51 -> 50"},
            {"input": "1000000000 9\n", "output": "1\n", "explanation": "Divides by 10 nine times."}
        ],
        "hidden_cases": [
            {"input": "10 1\n", "output": "1\n"},
            {"input": "11 1\n", "output": "10\n"},
            {"input": "100 2\n", "output": "1\n"},
            {"input": "123 3\n", "output": "12\n"}
        ]
    },
    "1A": {
        "problem_code": "1A",
        "contest_id": 1,
        "index": "A",
        "problem_name": "Theatre Square",
        "problem_rating": 1000,
        "tags": ["math"],
        "problem_url": "https://codeforces.com/problemset/problem/1/A",
        "time_limit_ms": 1000,
        "memory_limit_mb": 256,
        "description": """
### Problem Statement
Theatre Square in the capital city of Berland has a rectangular shape with the size $n \\times m$ meters. On the occasion of the city's anniversary, a decision was taken to pave the Square with square granite flagstones. Each flagstone is of the size $a \\times a$.

What is the least number of flagstones needed to pave the Square? It's allowed to cover the surface larger than the Theatre Square, but the Square has to be covered. It's not allowed to break the flagstones. The sides of flagstones should be parallel to the sides of the Square.

### Input
The input contains three positive integers: $n, m$ and $a$ ($1 \\le n, m, a \\le 10^9$).

### Output
Write the needed number of flagstones.
        """.strip(),
        "sample_cases": [
            {"input": "6 6 4\n", "output": "4\n", "explanation": "ceil(6/4) * ceil(6/4) = 2 * 2 = 4 flagstones."}
        ],
        "hidden_cases": [
            {"input": "1 1 1\n", "output": "1\n"},
            {"input": "1 1 2\n", "output": "1\n"},
            {"input": "12 13 4\n", "output": "12\n"},
            {"input": "1000000000 1000000000 1\n", "output": "1000000000000000000\n"}
        ]
    }
}

def get_problem_by_code(code: str) -> Optional[Dict[str, Any]]:
    """Retrieve problem details by problem code (e.g., '4A')."""
    return PROBLEMS.get(code.upper())

def get_random_problem(min_rating: int = 800, max_rating: int = 1600) -> Dict[str, Any]:
    """Return a random curated problem matching rating criteria."""
    matching = [
        p for p in PROBLEMS.values()
        if (p["problem_rating"] is None or (min_rating <= p["problem_rating"] <= max_rating))
    ]
    if not matching:
        matching = list(PROBLEMS.values())
    return random.choice(matching)

def list_curated_problems() -> List[Dict[str, Any]]:
    """Return list of all curated problems without hidden test cases."""
    result = []
    for p in PROBLEMS.values():
        result.append({
            "problem_code": p["problem_code"],
            "contest_id": p["contest_id"],
            "index": p["index"],
            "problem_name": p["problem_name"],
            "problem_rating": p["problem_rating"],
            "tags": p["tags"],
            "problem_url": p["problem_url"],
            "time_limit_ms": p.get("time_limit_ms", 1000),
            "memory_limit_mb": p.get("memory_limit_mb", 256),
            "sample_cases": p.get("sample_cases", [])
        })
    return result
