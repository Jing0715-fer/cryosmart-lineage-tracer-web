from PIL import Image, ImageDraw
W, H, C, R = 4, 3, 470, 520
sheet = Image.new('RGB', (W*C, H*R), (40,40,40))
d = ImageDraw.Draw(sheet)
for i in range(1,12):
    im = Image.open(f'img{i}.jpg')
    x = ((i-1) % W) * C + (C - im.width)//2
    y = ((i-1) // W) * R + 22 + (R-40 - im.height)//2
    sheet.paste(im, (x, y))
    d.text(((i-1)%W*C + 8, (i-1)//W*R + 4), f'image{i}.png', fill=(255,255,120))
sheet.save('montage.jpg', quality=88)
print(sheet.size)
