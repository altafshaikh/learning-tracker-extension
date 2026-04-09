import sys
from PIL import Image, ImageDraw, ImageFont

def generate_logo(size, filename):
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate dimensions
    padding = size * 0.1
    box_size = size - (padding * 2)
    radius = size * 0.2
    
    # Main rounded rectangle background (dark purple)
    draw.rounded_rectangle(
        [(padding, padding), (size - padding, size - padding)],
        radius=radius,
        fill="#8b7cf8"
    )
    
    # Draw a stylized play button / learning track symbol (green)
    triangle_padding = box_size * 0.3
    t_left = padding + triangle_padding
    t_top = padding + triangle_padding
    t_right = size - padding - triangle_padding
    t_bottom = size - padding - triangle_padding
    
    # Play button triangle
    draw.polygon(
        [(t_left, t_top), (t_left, t_bottom), (t_right, (t_top + t_bottom)/2)],
        fill="#3ecf8e"
    )
    
    img.save(filename)

if __name__ == "__main__":
    sizes = [16, 32, 48, 128]
    for size in sizes:
        generate_logo(size, f"icons/icon{size}.png")
    print("Icons generated successfully!")