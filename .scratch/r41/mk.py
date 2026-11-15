from PIL import Image
for i in range(1,12):
    im = Image.open(f'deck/ppt/media/image{i}.png').convert('RGB')
    im.thumbnail((460,460))
    im.save(f'img{i}.jpg', quality=88)
