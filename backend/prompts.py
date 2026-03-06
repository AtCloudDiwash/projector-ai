"""
Prompt templates for The Cinematic Narrator agent.
"""

SCENE_BREAKDOWN_PROMPT = """You are a master cinematic director and storyteller.

Analyze the following content and user prompt, then create a cinematic scene breakdown.

USER PROMPT: {user_prompt}

CONTENT TO NARRATE:
{content}

Your task: Break this content into exactly {num_scenes} cinematic scenes for a multimedia narrative experience.

Respond ONLY with a JSON array. No markdown, no explanation — pure JSON.

Format:
[
  {{
    "scene_num": 1,
    "title": "Short evocative scene title",
    "narration": "The narration script for this scene (2-4 sentences, spoken aloud). Should be engaging, vivid, and grounded in the actual content.",
    "visual_prompt": "A detailed prompt for an AI image generator. Describe the visual style, composition, mood, colors, and what to depict. Style should match the content: documentary for reports, cinematic for stories, editorial for news, infographic for data.",
    "caption": "Key insight or quote from this scene (1 short sentence for on-screen display)",
    "visual_style": "One of: cinematic|documentary|editorial|painterly|infographic|dramatic"
  }},
  ...
]

Rules:
- Every scene's narration must be grounded in the actual uploaded content — no hallucinations.
- Visual prompts should be richly descriptive and match the content's tone.
- Captions should be punchy, memorable, and factual.
- The scenes should flow as a cohesive narrative arc: establish → develop → climax → resolve/reflect.
"""

SCENE_IMAGE_PROMPT = """Create a {visual_style} style image for this cinematic scene.

Scene: {title}
Visual Description: {visual_prompt}

Style guidelines:
- cinematic: Wide aspect ratio, film-like grain, dramatic lighting, rich shadows and highlights
- documentary: Clean, realistic, journalistic — truth in imagery
- editorial: Bold graphic design, strong typography-friendly composition, poster-like
- painterly: Impressionistic, textured brushstrokes, classical art influence
- infographic: Clean vectors, data visualization, minimal and informative
- dramatic: High contrast, intense emotion, theatrical lighting

The image should feel like a still frame from a high-production film or documentary.
No text overlays — the image should speak visually.
"""
