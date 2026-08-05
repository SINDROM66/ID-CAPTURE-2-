import re
text = "MUYUNGAKLKTIMOTHY<<K<KLKLKLKLLKLKLLKLKLKL"
new_text = re.sub(r'([A-Z]{3,})(LKK|KKL|LKL|KKK|LLL|KLK|LKC|KLC)([A-Z]{3,})', r'\1<<\3', text)
print("Replaced:", new_text)
